import { spawn } from 'node:child_process'

export function redact(text, secrets = []) {
  let clean = String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
  for (const secret of secrets) if (secret) clean = clean.split(secret).join('[hidden]')
  return clean.replace(/(passphrase\s*(?:is|:|=)\s*)[^\r\n]+/gi, '$1[hidden]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[private key hidden]')
}

// cmd.exe is only needed for the vendor's .bat launcher. Reject shell syntax
// rather than trying to escape arbitrary command text through multiple parsers.
export function windowsBatchInvocation(file, args, comspec = 'C:\\Windows\\System32\\cmd.exe') {
  for (const value of [file, ...args]) {
    if (/[\x00-\x1f"%!?^&|<>]/.test(value)) throw new Error('The Samsung tool path or profile contains unsupported punctuation. Use a simple folder and profile name.')
  }
  return { file: comspec, args: ['/d', '/s', '/c', `"${[file, ...args].map(value => `"${value}"`).join(' ')}"`], windowsVerbatimArguments: true }
}

export function openVendorWindow(file) {
  const batch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(file)
  const command = batch ? windowsBatchInvocation(file, [], process.env.ComSpec) : { file, args: [] }
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { shell: false, detached: true, stdio: 'ignore', windowsHide: batch,
      windowsVerbatimArguments: command.windowsVerbatimArguments })
    child.once('error', () => reject(new Error('The Samsung window could not open. Open it from Tizen Studio’s Tools menu.')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export function runProcess(file, args, { cwd, signal, timeout = 90000, secret = '', suppressOutput = false, onLine = () => {} } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Cancelled.'))
  const command = process.platform === 'win32' && /\.(bat|cmd)$/i.test(file)
    ? windowsBatchInvocation(file, args, process.env.ComSpec) : { file, args }
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { cwd, shell: false, windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', sent = false, reason = '', total = 0
    const pending = { out: '', err: '' }
    const stop = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill() } }
    }
    const cancel = () => { reason = 'Cancelled. If installation had started, check the TV before trying again.'; stop() }
    const timer = setTimeout(() => { reason = 'The tool took too long. Check the TV connection and try again.'; stop() }, timeout)
    signal?.addEventListener('abort', cancel, { once: true })
    const emit = line => {
      const safe = redact(line, [secret]).slice(0, 2000)
      output = (output + safe + '\n').slice(-128000)
      if (safe.trim() && !suppressOutput) onLine(safe)
    }
    const receive = (stream, chunk) => {
      total += Buffer.byteLength(chunk)
      if (total > 2 * 1024 * 1024) { reason = 'The tool produced too much output. Open the vendor tool to inspect the problem.'; stop(); return }
      pending[stream] += chunk
      // Wait for LG's prompt before sending the passphrase; never put it in argv.
      if (secret && !sent && /input passphrase:/i.test(pending[stream])) { sent = true; child.stdin.end(secret + '\n') }
      let newline
      while ((newline = pending[stream].indexOf('\n')) !== -1) { emit(pending[stream].slice(0, newline)); pending[stream] = pending[stream].slice(newline + 1) }
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => receive('out', chunk)); child.stderr.on('data', chunk => receive('err', chunk))
    child.stdin.on('error', () => {})
    if (!secret) child.stdin.end()
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); secret = '' }
    child.on('error', error => { cleanup(); reject(new Error(error.code === 'ENOENT' ? 'A required tool was not found. Return to Computer tools and check its location.' : 'The tool could not be started.')) })
    child.on('close', code => {
      emit(pending.out); emit(pending.err); cleanup()
      if (reason) reject(new Error(reason))
      else if (code !== 0) reject(new Error('The vendor tool could not complete this step. See the activity details and troubleshooting tips.'))
      else resolve(output)
    })
  })
}

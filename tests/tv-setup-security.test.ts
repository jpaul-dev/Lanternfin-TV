import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { createSetupServer } from '../tv-setup/server.mjs'
import { privateIPv4, certificateProfile, connectedSamsung } from '../tv-setup/core.mjs'
import { redact, windowsBatchInvocation, runProcess } from '../tv-setup/runner.mjs'

const servers: ReturnType<typeof createSetupServer>[] = []
afterEach(async () => { for (const item of servers.splice(0)) await new Promise<void>(resolve => { item.server.closeAllConnections(); item.server.close(() => resolve()) }) })
async function fixture(execute = vi.fn().mockResolvedValue({ message: 'Done' })) {
  const service = { status: vi.fn().mockResolvedValue({ lgTools: true }), execute }
  const app = createSetupServer({ service }); servers.push(app)
  const session = await app.start()
  const headers = { Authorization: 'Bearer ' + session.token, 'Content-Type': 'application/json', Origin: session.origin }
  return { service, ...session, headers }
}
describe('local setup authentication boundary', () => {
  it('does not disclose status or run commands without the launch token', async () => {
    const { origin, service } = await fixture()
    const response = await fetch(origin + '/api/status', { method: 'POST', body: '{}' })
    expect(response.status).toBe(401); expect(service.status).not.toHaveBeenCalled()
  })
  it('rejects a valid token sent from another origin', async () => {
    const { origin, headers, service } = await fixture()
    const response = await fetch(origin + '/api/actions', { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body: JSON.stringify({ action: 'pair-lg' }) })
    expect(response.status).toBe(403); expect(service.execute).not.toHaveBeenCalled()
  })
  it('blocks Host rebinding even with the correct token', async () => {
    const { origin, headers } = await fixture()
    const status = await new Promise(resolve => {
      const req = request(origin + '/api/status', { method: 'POST', headers: { ...headers, Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode) })
      req.end('{}')
    })
    expect(status).toBe(403)
  })
  it('returns status for its authenticated local UI only', async () => {
    const { origin, headers } = await fixture()
    const response = await fetch(origin + '/api/status', { method: 'POST', headers, body: '{}' })
    expect(await response.json()).toEqual({ lgTools: true }); expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('does not echo malformed JSON or its potential secrets', async () => {
    const { origin, headers } = await fixture()
    const response = await fetch(origin + '/api/status', { method: 'POST', headers, body: 'secret-password' })
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('secret-password')
  })
  it('rejects oversized and arbitrary command requests', async () => {
    const { origin, headers, service } = await fixture()
    const big = await fetch(origin + '/api/actions', { method: 'POST', headers, body: JSON.stringify({ value: 'x'.repeat(8500) }) })
    expect(big.status).toBe(400)
    const shell = await fetch(origin + '/api/actions', { method: 'POST', headers, body: JSON.stringify({ action: 'exec', command: 'anything' }) })
    expect(shell.status).toBe(400); expect(service.execute).not.toHaveBeenCalled()
  })
  it('runs one job at a time and passes cancellation through to the runner', async () => {
    const execute = vi.fn((_action, _params, context) => new Promise((_resolve, reject) => { context.signal.addEventListener('abort', () => reject(new Error('Cancelled'))) }))
    const { origin, headers } = await fixture(execute)
    const start = () => fetch(origin + '/api/actions', { method: 'POST', headers, body: JSON.stringify({ action: 'check-lg', params: { ip: '192.168.1.50' } }) })
    expect((await start()).status).toBe(202); expect((await start()).status).toBe(409)
    await fetch(origin + '/api/cancel', { method: 'POST', headers, body: '{}' })
    await vi.waitFor(async () => { const result = await fetch(origin + '/api/job', { headers }).then(r => r.json()); expect(result.job.state).toBe('cancelled') })
  })
  it('serves only its fixed UI assets, with framing disabled', async () => {
    const { origin } = await fixture()
    const response = await fetch(origin + '/')
    expect(response.status).toBe(200); expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(await response.text()).not.toContain('Bearer')
    expect((await fetch(origin + '/core.mjs')).status).toBe(404)
  })
})
describe('CLI input validation and redaction', () => {
  it.each(['8.8.8.8', '127.0.0.1', '169.254.169.254', '::1', 'tv.example', '192.168.1.2 & whoami', '-s 192.168.1.2'])('rejects an unsafe target %s', ip => expect(() => privateIPv4(ip)).toThrow())
  it.each(['192.168.1.5', '10.1.2.3', '172.16.1.2', '172.31.2.3'])('accepts private TV address %s', ip => expect(privateIPv4(ip)).toBe(ip))
  it.each(['profile & cmd', 'abc%PATH%', 'x!x', '-option', 'abc\nnext'])('rejects unsafe profile %s', name => expect(() => certificateProfile(name)).toThrow())
  it('accepts profile names with spaces without treating them as shell commands', () => {
    expect(certificateProfile('Living Room TV')).toBe('Living Room TV')
    const result = windowsBatchInvocation('C:\\TV tools\\tizen.bat', ['package', '-s', 'Living Room TV'])
    expect(result.args.at(-1)).toBe('""C:\\TV tools\\tizen.bat" "package" "-s" "Living Room TV""')
  })
  it.each(['a&b', 'a|b', '%TEMP%', 'a^b', 'a"b', 'a\nb', 'a!b'])('does not pass shell punctuation to cmd: %s', input => expect(() => windowsBatchInvocation('C:\\tizen.bat', [input])).toThrow())
  it('requires the exact Samsung serial to be in device state', () => {
    expect(connectedSamsung('192.168.1.50:26101 offline tv', '192.168.1.50')).toBe(false)
    expect(connectedSamsung('192.168.1.51:26101 device tv', '192.168.1.50')).toBe(false)
    expect(connectedSamsung('List of devices attached\n192.168.1.50:26101 device tv', '192.168.1.50')).toBe(true)
  })
  it('redacts known pairing codes and labelled passphrases', () => {
    expect(redact('code AbC123; passphrase is zzzzzz', ['AbC123'])).not.toMatch(/AbC123|zzzzzz/)
  })
  it('handles a split pairing prompt over stdin without exposing the code in logs', async () => {
    const lines: string[] = []
    const script = "process.stdout.write('input pass'); setTimeout(()=>process.stdout.write('phrase:'), 20); process.stdin.once('data', code=>{ process.stdout.write(' echoed '+code); process.exit(0) })"
    const result = await runProcess(process.execPath, ['-e', script], { secret: 'AbC123', onLine: line => lines.push(line) })
    expect(result).not.toContain('AbC123'); expect(lines.join('')).not.toContain('AbC123')
  })
  it('keeps private vendor listings out of the activity callback', async () => {
    const onLine = vi.fn()
    const result = await runProcess(process.execPath, ['-e', "console.log('private vendor listing')"], { suppressOutput: true, onLine })
    expect(result).toContain('private vendor listing'); expect(onLine).not.toHaveBeenCalled()
  })
  it('terminates a timed-out child process', async () => {
    await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 })).rejects.toThrow('too long')
  })
})

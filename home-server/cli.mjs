import { spawn, spawnSync } from 'node:child_process'
import { readFile, mkdir, open, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(process.env.LANTERNFIN_HOME_DATA || resolve(homedir(), '.lanternfin', 'home'))
const command = process.argv[2] || 'start'
const delay = ms => new Promise(done => setTimeout(done, ms))
async function running() { try { return JSON.parse(await readFile(resolve(dataDir, 'running.json'), 'utf8')) } catch { return null } }
async function control(state, action) {
  const response = await fetch(`http://127.0.0.1:${state.port}/_home/control`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Home-Control': state.control }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(1500) })
  if (!response.ok) throw new Error('The running service did not recognize this launcher.')
  const result = await response.json()
  if (result.instance && result.instance !== state.instance) throw new Error('The running service has changed.')
  return result
}
function build() {
  console.log('Building the full Lanternfin web app. The first build can take a few minutes…')
  // Execute a fixed package-manager command, never shell-interpolate paths or input.
  const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'pnpm', process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm exec astro build --outDir dist/home'] : ['exec', 'astro', 'build', '--outDir', 'dist/home'], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, PUBLIC_APP_MODE: 'standalone', XTREAM_TV_BUILD: '0' } })
  if (result.error || result.status !== 0) throw new Error('Build failed. Install Node.js 24 and pnpm, then run pnpm install in this folder.')
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Lanternfin Home needs Node.js 24 or later.')
  if (!['start', 'stop', 'status'].includes(command)) throw new Error('Usage: node home-server/cli.mjs start|stop|status [--rebuild] [--no-open]')
  let state = await running(), live
  if (state) try { live = await control(state, 'status') } catch { /* Stale runtime files are checked by the server lock. */ }
  if (command === 'stop') {
    if (!live) { console.log('Lanternfin Home is already stopped. Your saved library is kept.'); process.exit(0) }
    await control(state, 'stop')
    for (let i = 0; i < 40; i++) { await delay(200); try { await control(state, 'status') } catch { console.log('Lanternfin Home stopped. Your saved library is kept.'); process.exit(0) } }
    throw new Error('The server is still shutting down. Run stop again to check; no unrelated processes were stopped.')
  }
  if (command === 'status' && !live) { console.log('Lanternfin Home is stopped.'); process.exit(0) }
  if (command === 'start' && !live) {
    if (process.argv.includes('--rebuild') || !await stat(resolve(root, 'dist/home/index.html')).catch(() => null)) build()
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const log = await open(resolve(dataDir, 'server.log'), 'a', 0o600)
    const child = spawn(process.execPath, [resolve(root, 'home-server/server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: process.env })
    child.unref(); await log.close()
    for (let i = 0; i < 100; i++) {
      await delay(200); state = await running()
      if (state) try { live = await control(state, 'status'); break } catch { /* The child may still be starting. */ }
    }
    if (!live) throw new Error(`The home server could not start. Check ${resolve(dataDir, 'server.log')}`)
    // Give mDNS probing a moment to choose a unique name before printing it.
    for (let i = 0; i < 20 && live.discovery === 'Starting'; i++) { await delay(250); live = await control(state, 'status') }
  } else if (live && process.argv.includes('--rebuild')) throw new Error('Run stop first, then start --rebuild, so the running app is not replaced during playback.')
  const info = command === 'start' ? await control(state, 'code') : live
  const suffix = info.port === 80 ? '' : `:${info.port}`
  console.log(`\nLanternfin Home\n  Address: http://${info.hostname}${suffix}/`)
  for (const ip of info.addresses) console.log(`  IP fallback: http://${ip}${suffix}/`)
  console.log(`  Discovery: ${info.discovery}\n  Library: ${dataDir}`)
  if (info.code) console.log(`\n  Pairing code: ${info.code.slice(0, 4)} ${info.code.slice(4)} (10 minutes)\n  Run start again for a new code. Paired devices stay signed in.`)
  if (info.port !== 80) console.log(`\n  Port 80 is unavailable. Include :${info.port} in the address.`)
  console.log('\nKeep this computer awake. If Windows asks, allow Node.js on your private home network.\nUse stop.bat or ./stop.sh to stop the server.\n')
  if (command === 'start' && !process.argv.includes('--no-open')) {
    const address = `http://localhost${suffix}/`
    const args = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', address]] : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]]
    const opener = spawn(args[0], args[1], { detached: true, stdio: 'ignore', windowsHide: true }); opener.on('error', () => {}); opener.unref()
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }

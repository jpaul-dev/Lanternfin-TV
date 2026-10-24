import { createServer } from 'node:http'
import { readFile, stat, mkdir, writeFile, unlink, open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { resolve, sep, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces, homedir } from 'node:os'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { HomeStore } from './store.mjs'
import { mediaRequest, relay } from './relay.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const projectRoot = resolve(here, '..')
export const defaultData = () => resolve(process.env.LANTERNFIN_HOME_DATA || resolve(homedir(), '.lanternfin', 'home'))
export const localAddresses = () => Object.entries(networkInterfaces()).filter(([name]) => !/Default Switch|WSL|docker|^veth[0-9a-f]+(?:$|@)|^virbr|^br-|vmnet|VirtualBox|Tailscale|^tun|^utun/i.test(name)).flatMap(([, entries]) => entries || []).filter(a => a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a => a.address)
async function advertisedAddresses() {
  const addresses = localAddresses()
  if (process.env.LANTERNFIN_HOME_ADDRESS) {
    if (!addresses.includes(process.env.LANTERNFIN_HOME_ADDRESS)) throw new Error('LANTERNFIN_HOME_ADDRESS must be a local home-network IPv4 address.')
    return [process.env.LANTERNFIN_HOME_ADDRESS]
  }
  // UDP connect selects a route without sending a packet. Prefer the actual LAN
  // interface so virtual switches do not advertise an unreachable .local address.
  const selected = await new Promise(done => {
    const socket = createSocket('udp4'), timeout = setTimeout(() => { socket.close(); done('') }, 1000)
    socket.once('error', () => { clearTimeout(timeout); socket.close(); done('') })
    socket.connect(9, '192.0.2.1', () => { clearTimeout(timeout); const address = socket.address().address; socket.close(); done(address) })
  })
  return addresses.includes(selected) ? [selected] : addresses
}
const localClient = address => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test((address || '').replace(/^::ffff:/, '')) || address === '::1'
const sameSecret = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
async function body(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Request too large.'), { status: 413 }); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('Invalid JSON request.') }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' }
export async function startServer(options = {}) {
  const dataDir = options.dataDir || defaultData(), webRoot = options.webRoot || resolve(projectRoot, 'dist/home')
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const lockFile = resolve(dataDir, 'server.lock')
  let lock
  if (options.runtime !== false) {
    try { lock = await open(lockFile, 'wx', 0o600) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const previous = JSON.parse(await readFile(lockFile, 'utf8'))
      let alive = true
      try { process.kill(previous.pid, 0) } catch (e) { if (e.code === 'ESRCH') alive = false }
      if (alive) throw new Error('Lanternfin Home is already running or starting.', { cause: error })
      await unlink(lockFile)
      lock = await open(lockFile, 'wx', 0o600)
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }))
  }
  const store = new HomeStore(resolve(dataDir, 'home.sqlite'))
  const addresses = await advertisedAddresses()
  const control = randomBytes(32).toString('hex'), instance = randomBytes(12).toString('hex')
  let hostname = 'lanternfin.local', discovery = 'Starting', responder, closing = false
  const runtimeFile = resolve(dataDir, 'running.json')
  let server
  const runtime = () => ({ id: store.id, instance, pid: process.pid, port: server.address().port, hostname, discovery, addresses, control })
  async function saveRuntime() { if (!closing && options.runtime !== false) await writeFile(runtimeFile, JSON.stringify(runtime()), { mode: 0o600 }) }
  async function close() {
    if (closing) return
    closing = true
    if (responder) await responder.shutdown().catch(() => {})
    server.closeAllConnections()
    await new Promise(done => server.close(done))
    store.close()
    if (lock) { await lock.close(); await unlink(lockFile).catch(() => {}) }
    if (options.runtime !== false) {
      try { if (JSON.parse(await readFile(runtimeFile, 'utf8')).instance === instance) await unlink(runtimeFile) } catch { /* Runtime metadata may already have been removed. */ }
    }
  }
  server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    try {
      if (!localClient(req.socket.remoteAddress)) return json(res, { error: 'Home network access only.' }, 403)
      const port = server.address().port
      const host = new URL(`http://${req.headers.host || ''}`)
      if (!['localhost', '127.0.0.1', hostname, ...localAddresses()].includes(host.hostname) || Number(host.port || 80) !== port) return json(res, { error: 'Unknown home address.' }, 403)
      const origin = req.headers.origin
      const sameOrigin = !origin || origin === host.origin
      const appOrigin = ['null', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(origin)
      if (!sameOrigin && !appOrigin) return json(res, { error: 'Origin not allowed.' }, 403)
      if (appOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Lanternfin-Home'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS') }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
      const url = new URL(req.url, host)
      if (url.pathname === '/_home/control' && req.method === 'POST') {
        if (!/^127\./.test(req.socket.remoteAddress.replace(/^::ffff:/, '')) || !sameSecret(req.headers['x-home-control'], control)) return json(res, { error: 'Not authorized.' }, 401)
        const data = await body(req)
        if (data.action === 'stop') { json(res, { stopped: true }); setTimeout(() => void close(), 50); return }
        if (data.action === 'code') { return json(res, { ...runtime(), control: undefined, code: store.renewCode(), codeExpires: store.codeExpires }) }
        return json(res, { ...runtime(), control: undefined })
      }
      if (req.method === 'POST' && req.headers['x-lanternfin-home'] !== '1') return json(res, { error: 'Missing application header.' }, 403)
      if (url.pathname === '/_home/pair' && req.method === 'POST') {
        const data = await body(req), session = store.pair(data.code, data.name, req.socket.remoteAddress)
        if (sameOrigin && !data.native) { res.setHeader('Set-Cookie', `lf_home=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`); delete session.token }
        return json(res, session)
      }
      const cookie = sameOrigin ? /(?:^|;\s*)lf_home=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1] : undefined
      const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '')?.[1] || cookie
      const device = store.authorize(token)
      if (url.pathname === '/_home/login.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(await readFile(resolve(here, 'login.js'))) }
      if (!device) {
        if (url.pathname.startsWith('/_home/') && url.pathname !== '/_home/' || !['GET', 'HEAD'].includes(req.method)) return json(res, { error: 'Pair this device with Lanternfin Home.' }, 401)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.end(await readFile(resolve(here, 'login.html')))
      }
      if (url.pathname === '/_home/state' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0)
        if (!Number.isSafeInteger(since) || since < 0) throw new Error('Invalid sync cursor.')
        return json(res, store.snapshot(since))
      }
      if (url.pathname === '/_home/sync' && req.method === 'POST') { const data = await body(req); return json(res, store.sync(data.changes, data.since)) }
      if (url.pathname === '/_home/devices' && req.method === 'GET') return json(res, { devices: store.devices(), current: device.id })
      if (url.pathname === '/_home/revoke' && req.method === 'POST') { store.revoke((await body(req)).id); return json(res, { ok: true }) }
      if (url.pathname === '/_home/logout' && req.method === 'POST') { store.revoke(device.id); res.setHeader('Set-Cookie', 'lf_home=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, { ok: true }) }
      const blocked = ['127.0.0.1', ...localAddresses()].map(ip => `${ip}:${port}`)
      if (url.pathname === '/_home/fetch' && req.method === 'POST') {
        const data = await body(req)
        if (!['GET', 'HEAD', 'POST'].includes(data.method || 'GET') || data.body && (typeof data.body !== 'string' || data.body.length > 1024 * 1024)) throw new Error('Unsupported provider request.')
        return await relay(req, res, data.url, data, false, blocked)
      }
      if (url.pathname.startsWith('/_home/media/') && ['GET', 'HEAD'].includes(req.method)) {
        const media = mediaRequest(req.url)
        return await relay(req, res, media.url, { method: req.method, headers: { ...media.headers, ...(req.headers.range ? { range: req.headers.range } : {}) } }, true, blocked, media.context)
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: 'Method not allowed.' }, 405)
      const pathname = decodeURIComponent(url.pathname)
      let file = resolve(webRoot, `.${pathname}`)
      if (!file.startsWith(resolve(webRoot) + sep) && file !== resolve(webRoot)) return json(res, { error: 'Not found.' }, 404)
      try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html') } catch {
        if (!extname(file)) file = resolve(file, 'index.html')
      }
      const info = await stat(file).catch(() => null)
      if (!info?.isFile()) return json(res, { error: 'Page not found. Run start with --rebuild if the web app is missing.' }, 404)
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
      if (req.method === 'HEAD') return res.end()
      if (file.endsWith('.html')) {
        const html = await readFile(file, 'utf8')
        return res.end(html.replace('<head>', '<head><script>window.__LANTERNFIN_HOME__=true;</script>'))
      }
      createReadStream(file).on('error', () => res.destroy()).pipe(res)
    } catch (e) {
      // Provider URLs, account passwords and tokens must never reach logs or error pages.
      if (res.headersSent) res.destroy()
      else json(res, { error: e.status === 401 || e.status === 429 ? e.message : 'The request could not be completed. Check the connection and supplied values.' }, e.status || 400)
    }
  })
  server.requestTimeout = 60000
  server.headersTimeout = 15000
  async function listen(port) { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); done() }) }) }
  try { await listen(options.port ?? Number(process.env.LANTERNFIN_HOME_PORT || 80)) } catch (e) {
    if (options.port !== undefined || process.env.LANTERNFIN_HOME_PORT || !['EACCES', 'EADDRINUSE'].includes(e.code)) { store.close(); throw e }
    await listen(47820)
  }
  await saveRuntime()
  if (options.mdns !== false && addresses.length) {
    try {
      const { default: ciao } = await import('@homebridge/ciao')
      responder = ciao.getResponder()
      const service = responder.createService({ name: 'Lanternfin Home', hostname: 'lanternfin', type: 'http', port: server.address().port, restrictedAddresses: addresses, disabledIpv6: true, txt: { path: '/', app: 'lanternfin', version: '1' } })
      service.on('hostname-change', name => { hostname = name.replace(/\.$/, ''); void saveRuntime() })
      service.on('name-change', () => {})
      void service.advertise().then(() => { hostname = service.getHostname().replace(/\.$/, ''); discovery = 'Ready'; return saveRuntime() }).catch(() => { discovery = 'Unavailable; use the IP address'; void saveRuntime() })
    } catch { discovery = 'Unavailable; use the IP address'; await saveRuntime() }
  } else { discovery = 'Disabled'; await saveRuntime() }
  return { server, store, close, runtime }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer({ mdns: process.env.LANTERNFIN_HOME_MDNS !== '0' })
  process.on('SIGINT', () => void app.close())
  process.on('SIGTERM', () => void app.close())
}

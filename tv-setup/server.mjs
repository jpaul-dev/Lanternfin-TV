import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createSetupService, ACTIONS } from './core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export function createSetupServer({ root = resolve(here, '..'), service = createSetupService({ root }), token = randomBytes(32).toString('hex'), idleMs = 60 * 60 * 1000 } = {}) {
  let origin = '', job = null, controller = null, lastSeen = Date.now()
  const security = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  }
  const json = (response, status, value) => { response.writeHead(status, { ...security, 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
  function authenticated(request) {
    const value = Buffer.from(request.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`)
    return value.length === expected.length && timingSafeEqual(value, expected)
  }
  async function body(request) {
    if (request.headers['content-type'] !== 'application/json') throw new Error('Use a JSON request.')
    let size = 0; const chunks = []
    for await (const chunk of request) { size += chunk.length; if (size > 8192) throw new Error('Request is too large.'); chunks.push(chunk) }
    let value
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw new Error('Invalid JSON request.') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.')
    return value
  }
  const server = createServer(async (request, response) => {
    if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') { json(response, 403, { error: 'Open setup using its local launcher.' }); return }
    const path = new URL(request.url, origin).pathname
    try {
      if (path.startsWith('/api/')) {
        if (!authenticated(request)) { json(response, 401, { error: 'This setup session has expired. Reopen TV Setup from its launcher.' }); return }
        lastSeen = Date.now()
        if (path === '/api/status' && request.method === 'POST') {
          const data = await body(request); json(response, 200, await service.status(data.sdkRoot || '')); return
        }
        if (path === '/api/job' && request.method === 'GET') { json(response, 200, { job }); return }
        if (path === '/api/actions' && request.method === 'POST') {
          if (job?.state === 'running') { json(response, 409, { error: 'Wait for the current step to finish or cancel it.' }); return }
          const data = await body(request)
          if (!ACTIONS.includes(data.action)) { json(response, 400, { error: 'Unknown setup action.' }); return }
          const params = data.params && typeof data.params === 'object' && !Array.isArray(data.params) ? data.params : {}
          controller = new AbortController()
          const current = { id: randomUUID(), action: data.action, state: 'running', message: 'Starting…', logs: [], result: null }
          job = current
          json(response, 202, { id: current.id })
          Promise.resolve().then(() => service.execute(data.action, params, {
            signal: controller.signal,
            log: line => { current.logs.push(String(line).slice(0, 2000)); if (current.logs.length > 150) current.logs.shift() },
            step: message => { current.message = message },
          })).then(result => { current.state = 'succeeded'; current.result = result; current.message = result.message }, error => {
            current.state = controller.signal.aborted ? 'cancelled' : 'failed'; current.message = error.message || 'Setup could not complete this step.'
          }).finally(() => { params.passphrase = ''; lastSeen = Date.now() })
          return
        }
        if (path === '/api/cancel' && request.method === 'POST') { await body(request); controller?.abort(); json(response, 200, { message: 'Cancellation requested.' }); return }
        if (path === '/api/shutdown' && request.method === 'POST') { await body(request); controller?.abort(); json(response, 200, { message: 'Setup closed. You can close this tab.' }); setTimeout(() => server.close(), 150); return }
        json(response, 404, { error: 'No such setup action.' }); return
      }
      if (request.method !== 'GET') { json(response, 405, { error: 'Method not allowed.' }); return }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'], '/mark.svg': ['mark.svg', 'image/svg+xml'] }
      if (!assets[path]) { json(response, 404, { error: 'Not found.' }); return }
      const [file, mime] = assets[path]
      response.writeHead(200, { ...security, 'Content-Type': mime }); response.end(await readFile(resolve(here, 'public', file)))
    } catch (error) { if (!response.headersSent) json(response, 400, { error: error.message || 'Invalid request.' }); else response.end() }
  })
  server.requestTimeout = 15000; server.headersTimeout = 10000
  const idle = setInterval(() => { if (job?.state !== 'running' && Date.now() - lastSeen > idleMs) server.close() }, Math.min(idleMs, 30000))
  idle.unref()
  server.on('close', () => { clearInterval(idle); controller?.abort() })
  return {
    server,
    async start() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      origin = `http://127.0.0.1:${server.address().port}`
      return { origin, url: `${origin}/#${token}`, token }
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('TV Setup needs Node.js 22 or newer.')
  const setup = createSetupServer(), session = await setup.start()
  const sessionFlag = process.argv.indexOf('--session-file')
  if (sessionFlag >= 0) await writeFile(resolve(process.argv[sessionFlag + 1]), JSON.stringify(session), { mode: 0o600 })
  console.log(`Lanternfin TV Setup is running locally at ${session.origin}. Use the launcher to open its private session.`)
  if (process.argv.includes('--open')) {
    const file = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const browser = spawn(file, [session.url], { windowsHide: true, detached: true, stdio: 'ignore' })
    browser.on('error', () => console.error('Could not open the browser.')); browser.unref()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => setup.server.close())
}

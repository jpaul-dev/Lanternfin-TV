import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/tv/browser')
const fixtures = process.argv.includes('--fixtures')
const portFlag = process.argv.indexOf('--port')
const port = portFlag < 0 ? 4323 : Number(process.argv[portFlag + 1])
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port from 1024 to 65535.')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4323').pathname)
    if (fixtures && ['/_test/playlist.m3u', '/_test/large.m3u'].includes(pathname)) {
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
      const count = pathname === '/_test/large.m3u' ? 120000 : 50
      let entry = 0
      response.write('#EXTM3U\n')
      const write = () => {
        if (response.destroyed) return
        let chunk = ''
        for (let n = 0; n < 500 && entry < count; n++, entry++) chunk += `#EXTINF:-1 tvg-id="demo-${entry}" tvg-logo="https://images.example/${'x'.repeat(100)}" group-title="${['Nature', 'Cinema', 'Radio'][entry % 3]}",${entry === 0 ? '<b>Inert title</b>' : `Test stream ${entry + 1}`}\nhttp://127.0.0.1:${port}/_test/unavailable.mp4?id=${entry}\n`
        const ready = response.write(chunk)
        if (entry === count) response.end()
        else if (ready) setImmediate(write)
        else response.once('drain', write)
      }
      write(); return
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + sep)) { response.writeHead(403); response.end(); return }
    const data = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); response.end(data)
  } catch { response.writeHead(404); response.end('Not found') }
}).listen(port, '127.0.0.1', () => console.log(`TV browser preview: http://127.0.0.1:${port}${fixtures ? ' (test fixtures enabled)' : ''}`))

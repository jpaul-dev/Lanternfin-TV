import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/tv/browser')
const fixtures = process.argv.includes('--fixtures')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' }
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4323').pathname)
    if (fixtures && pathname === '/_test/playlist.m3u') {
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Cache-Control': 'no-store' })
      response.end('#EXTM3U\n' + Array.from({ length: 50 }, (_, i) => `#EXTINF:-1 group-title="${['Nature', 'Cinema', 'Radio'][i % 3]}",${i === 0 ? '<b>Inert title</b>' : `Test stream ${i + 1}`}\nhttp://127.0.0.1:4323/_test/unavailable.mp4`).join('\n')); return
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + sep)) { response.writeHead(403); response.end(); return }
    const data = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); response.end(data)
  } catch { response.writeHead(404); response.end('Not found') }
}).listen(4323, '127.0.0.1', () => console.log(`TV browser preview: http://127.0.0.1:4323${fixtures ? ' (test fixtures enabled)' : ''}`))

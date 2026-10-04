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
    if (fixtures && ['/_test/subtitled.mp4', '/_test/webvtt.mp4'].includes(pathname)) {
      // Optional locally generated video, never copied into a TV package.
      const data = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), pathname === '/_test/webvtt.mp4' ? '../artifacts/tv-mp4-webvtt-demo.mp4' : '../artifacts/tv-mp4-text-demo.mp4'))
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '')
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1
      if (start > end || !Number.isSafeInteger(start)) { response.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); response.end(); return }
      response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) })
      response.end(data.subarray(start, end + 1)); return
    }
    if (fixtures && pathname === '/_test/captions.vtt') {
      const stamp = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`
      response.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
      response.end('WEBVTT\n\n' + Array.from({ length: 120 }, (_, n) => `${stamp(n * 5)} --> ${stamp(n * 5 + 5)}\nLanternfin subtitle check\nExternal WebVTT · cue ${n + 1}\n`).join('\n')); return
    }
    if (fixtures && pathname === '/_test/captions.ass') {
      const stamp = seconds => `0:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00`
      response.writeHead(200, { 'Content-Type': 'text/x-ass; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
      response.end('[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + Array.from({ length: 120 }, (_, n) => `Dialogue: 0,${stamp(n * 5)},${stamp(n * 5 + 5)},Default,,0,0,0,,{\\i1}Lanternfin caption check{\\i0}\\NASS dialogue, cue ${n + 1}{\\p1}m 0 0 l 100 100{\\p0}\n`).join('')); return
    }
    if (fixtures && ['/_test/provider/player_api.php', '/_test/large-provider/player_api.php'].includes(pathname)) {
      const params = new URL(request.url, `http://127.0.0.1:${port}`).searchParams
      const action = params.get('action') || ''
      const art = `http://127.0.0.1:${port}/_test/art.svg`
      const count = pathname.includes('/large-provider/') ? 20000 : 10
      const categories = [{ category_id: '1', category_name: 'UI test library' }]
      const info = { plot: 'A sample title for checking the TV detail page. Artwork, credits and episodes come from a local test provider. No media or subscriptions are included in this fixture.', movie_image: art, cover: art, backdrop_path: [`http://127.0.0.1:${port}/_test/backdrop.svg?n=${Number(params.get('vod_id') || params.get('series_id')) || 0}`], releasedate: '2026-01-01', genre: 'UI demonstration', duration: '01:30:00', rating: '8.2', cast: 'Demo cast', director: 'Demo director' }
      const episodeNames = ['The arrival', 'A new direction', 'Between the lines', 'The long way home', 'An unexpected visitor', 'Open water']
      const seasonEpisodes = (season, length) => Array.from({ length }, (_, i) => ({ id: season * 100 + i + 1, season, episode_num: i + 1, title: `${episodeNames[i % episodeNames.length]}${i >= episodeNames.length ? ` · Part ${Math.floor(i / episodeNames.length) + 1}` : ''}`, container_extension: 'mp4', info: { duration_secs: 2500 + i * 17, movie_image: `${art}?n=${i}`, plot: 'A locally generated episode synopsis for checking the series screen, remote navigation and viewing progress. No playable media is included.' } }))
      const episodes = { 1: seasonEpisodes(1, 30), 2: seasonEpisodes(2, 8) }
      const now = Math.floor(Date.now() / 3600000) * 3600
      const epg = { epg_listings: Array.from({ length: 13 }, (_, n) => { const index = n - 5; return { has_archive: index <= 0 ? 1 : 0, start_timestamp: now + index * 3600, stop_timestamp: now + (index + 1) * 3600, title: Buffer.from(index ? `${index < 0 ? "Earlier" : "Next"} programme ${Math.abs(index)}` : 'Morning on Lanternfin').toString('base64'), description: Buffer.from('A generated programme listing for checking the guide. This is local test data.').toString('base64') } }) }
      const data = !action ? { user_info: { auth: 1 }, server_info: { timestamp_now: Math.floor(Date.now() / 1000), time_now: new Date().toISOString().slice(0, 19).replace('T', ' '), timezone: 'UTC' } } : action.includes('epg') || action.includes('data_table') || action.includes('date_table') ? epg : action.endsWith('_categories') ? categories : action === 'get_series_info' ? { info, episodes } : action === 'get_vod_info' ? { info } : Array.from({ length: count }, (_, index) => ({ stream_id: index + 1, year: 2000 + index % 26, rating: (6 + index % 10 * .35).toFixed(1), ...(index ? { added: String(now - (count - 1 - index) * 60) } : {}), tv_archive: 1, tv_archive_duration: 7, series_id: index + 1, name: `${action === 'get_series' ? 'Series' : action === 'get_vod_streams' ? 'Movie' : 'Channel'} sample ${index + 1}`, stream_icon: art + `?n=${index}`, cover: art + `?n=${index}`, container_extension: 'mp4' }))
      response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); return
    }
    if (fixtures && pathname === '/_test/guide-floating.xml') {
      const now = Date.now(), stamp = ms => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const entries = Array.from({ length: 50 }, (_, index) => `<channel id="demo-${index}"><display-name>Test stream ${index + 1}</display-name></channel><programme channel="demo-${index}" start="${stamp(now + 115 * 60000)}" stop="${stamp(now + 125 * 60000)}"><title>Floating-time guide demo</title><desc>Generated two hours ahead without a time zone, for checking automatic schedule correction.</desc></programme>`).join('')
      response.writeHead(200, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); response.end(`<tv>${entries}</tv>`); return
    }
    if (fixtures && pathname === '/_test/backdrop.svg') {
      const index = Number(new URL(request.url, `http://127.0.0.1:${port}`).searchParams.get('n')) || 0
      const color = ['#716497', '#a37760', '#467f93', '#7d759a', '#668474'][Math.abs(Math.trunc(index)) % 5] || '#716497'
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#131726"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1920v1080H0z"/><circle cx="1450" cy="310" r="180" fill="#ffffff28"/><path d="M0 900L630 190 1050 700 1470 520 1920 850V1080H0z" fill="#181d3788"/><path d="M0 1000L1100 590 1570 930 1920 640V1080H0z" fill="#121a2bb0"/><text x="1450" y="1020" fill="#c4c6d2" font-family="sans-serif" font-size="20" letter-spacing="3">LOCAL BACKDROP DEMO</text></svg>`); return
    }
    if (fixtures && pathname === '/_test/art.svg') {
      const index = Number(new URL(request.url, `http://127.0.0.1:${port}`).searchParams.get('n')) || 0
      const palette = ['#7962a7', '#a4785b', '#538e9b', '#927590', '#729077']
      const color = palette[Math.abs(index) % palette.length]
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#131726"/></linearGradient></defs><path fill="url(#g)" d="M0 0h400v600H0z"/><circle cx="290" cy="180" r="80" fill="#ffffff28"/><path d="M0 420L170 220 330 410 400 300V600H0" fill="#11192988"/><path d="M0 490L250 350 400 490V600H0" fill="#111724"/><text x="32" y="75" fill="#fff" font-family="sans-serif" font-size="18" letter-spacing="5">UI TEST LIBRARY</text><text x="32" y="525" fill="#fff" font-family="sans-serif" font-size="44">SAMPLE ${index + 1}</text><text x="32" y="560" fill="#aaa" font-family="sans-serif" font-size="16">Generated test artwork · no media</text></svg>`); return
    }
    if (fixtures && pathname === '/_test/guide.xml') {
      const now = Math.floor(Date.now() / 3600000) * 3600000, stamp = value => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
      const programmes = Array.from({ length: 50 }, (_, channel) => `<channel id="demo-${channel}"><display-name>Test stream ${channel + 1}</display-name></channel>` + Array.from({ length: 360 }, (_, index) => { const hour = index - 240; return `<programme channel="demo-${channel}" start="${stamp(now + hour * 3600000)}" stop="${stamp(now + (hour + 1) * 3600000)}"><title>XMLTV programme ${hour + 1}</title><desc>Local XMLTV demonstration for channel ${channel + 1}. Generated hourly listings cover previous and future days.</desc></programme>` }).join('')).join('')
      response.writeHead(200, { 'Content-Type': 'application/xml', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); response.end(`<tv>${programmes}</tv>`); return
    }
    if (fixtures && pathname === '/_test/variants.m3u') {
      const entries = ['EN - Evening Light (2026)', 'FR - Evening Light (2026)', '4K-FR - Evening Light (2026)', 'EN - Evening Light (2021)', 'EN - Open Water', 'ES - Open Water'].map((name, index) => `#EXTINF:-1 tvg-type="movie" tvg-logo="http://127.0.0.1:${port}/_test/art.svg?n=${index}" group-title="Language version demo",${name}\nhttp://127.0.0.1:${port}/_test/unavailable.mp4?id=${index}\n`).join('')
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); response.end('#EXTM3U\n' + entries); return
    }
    if (fixtures && pathname === '/_test/browse.m3u') {
      const entries = Array.from({ length: 60 }, (_, index) => `#EXTINF:-1 tvg-type="movie" tvg-logo="http://127.0.0.1:${port}/_test/art.svg?n=${index}" group-title="UI test movies",${index % 2 ? 'FR' : 'EN'} - Movie ${index + 1}\nhttp://127.0.0.1:${port}/_test/unavailable.mp4?id=${index}\n`).join('')
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); response.end('#EXTM3U\n' + entries); return
    }
    if (fixtures && ['/_test/playlist.m3u', '/_test/large.m3u'].includes(pathname)) {
      response.writeHead(200, { 'Content-Type': 'audio/x-mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
      const count = pathname === '/_test/large.m3u' ? 120000 : 50
      let entry = 0
      response.write(`#EXTM3U x-tvg-url="http://127.0.0.1:${port}/_test/guide.xml"\n`)
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

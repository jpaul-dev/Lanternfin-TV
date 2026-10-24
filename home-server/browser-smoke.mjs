// Run after home:build. Optional local test movie: LANTERNFIN_TEST_MEDIA.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, rm, mkdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { startServer, localAddresses, projectRoot } from './server.mjs'
import { sourceKey } from '../shared/home-protocol.mjs'

const dataDir = await mkdtemp(resolve(tmpdir(), 'lanternfin-browser-test-'))
const media = process.env.LANTERNFIN_TEST_MEDIA
let mediaRequests = 0
const provider = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture')
  if (url.pathname.endsWith('.mp4') && media) {
    mediaRequests++
    const size = (await stat(media)).size, range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
    const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) })
    createReadStream(media, { start, end }).pipe(res); return
  }
  res.setHeader('Content-Type', 'application/json')
  const movie = { stream_id: 42, name: 'Home sync test movie', stream_icon: '', category_id: '1', container_extension: 'mp4', rating: '8', added: '1760000000' }
  const action = url.searchParams.get('action')
  const data = !action ? { user_info: { auth: 1, status: 'Active', username: 'fixture', exp_date: '2100000000', max_connections: '5' }, server_info: { url: 'fixture', timezone: 'UTC' } }
    : action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'Test movies' }]
    : action === 'get_vod_streams' ? [movie]
    : action === 'get_vod_info' ? { info: { name: movie.name, plot: 'A local fixture for testing household playback.', duration_secs: 120 }, movie_data: movie }
    : []
  res.end(JSON.stringify(data))
})
await new Promise(done => provider.listen(0, '0.0.0.0', done))
const ip = localAddresses()[0]
if (!ip) throw new Error('Connect to a home network before running the browser integration test.')
const app = await startServer({ dataDir, port: 0, mdns: false, runtime: false })
const source = { type: 'xtream', title: 'Home test library', serverUrl: `http://${ip}:${provider.address().port}`, username: 'fixture', password: 'test-only', liveContainer: 'm3u8' }
const key = sourceKey(source), sourceRow = `source/${key}`, progressRow = `progress/${key}/vod/42`
app.store.sync([{ key: sourceRow, value: source, base: 0, op: 'fixture-source' }, { key: progressRow, value: { position: 15, duration: 120, completed: false, name: 'Home sync test movie' }, base: 0, op: 'fixture-progress' }])
const base = `http://127.0.0.1:${app.server.address().port}`
const browser = await chromium.launch({ channel: process.env.LANTERNFIN_TEST_BROWSER || 'msedge', headless: true })
const errors = []
try {
  const first = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 960 } }), second = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 412, height: 915 } })
  const a = await first.newPage(), b = await second.newPage()
  for (const page of [a, b]) {
    page.on('pageerror', error => errors.push(error.stack || error.message))
    await page.goto(base)
    await page.locator('#code').fill(app.store.code)
    await page.getByRole('button', { name: 'Join this home' }).click()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xt_playlists') || '{}').entries?.length === 1)
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('xt_prefs') || '{}')).some(p => p.progVod?.['42']?.position === 15))
  }
  // Updating one title reaches a second live browser without replacing its account ID.
  const row = app.store.snapshot().rows.find(r => r.key === progressRow)
  app.store.sync([{ key: progressRow, value: { position: 35, duration: 120, completed: false, name: 'Home sync test movie' }, base: row.version, op: 'fixture-progress-35' }])
  await b.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('xt_prefs') || '{}')).some(p => p.progVod?.['42']?.position === 35), { timeout: 12000 })
  await a.goto(base + '/settings/')
  await a.getByRole('button', { name: 'Manage home connection' }).click()
  await a.getByRole('dialog').waitFor()
  assert.match(await a.getByRole('dialog').innerText(), /Connected|Synced/)
  await a.getByRole('button', { name: 'Done', exact: true }).click()
  await b.goto(base + '/movies/')
  await b.getByText('Home sync test movie', { exact: true }).first().waitFor()
  await mkdir(resolve(projectRoot, 'artifacts/home-smoke'), { recursive: true })
  await a.screenshot({ path: resolve(projectRoot, 'artifacts/home-smoke/desktop.png') })
  await b.screenshot({ path: resolve(projectRoot, 'artifacts/home-smoke/phone.png') })
  // Same-origin authenticated relay supports byte ranges without provider CORS.
  if (media) {
    const address = source.serverUrl + '/movie/fixture/test-only/42.mp4'
    const u = new URL(address)
    const relayUrl = `/_home/media/http/${u.host}${u.pathname}`
    const result = await a.evaluate(async url => { const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } }); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength } }, relayUrl)
    assert.deepEqual(result, { status: 206, bytes: 1024 })
    assert.ok(mediaRequests > 0)
    await b.getByText('Home sync test movie', { exact: true }).first().click()
    await b.getByText('A local fixture for testing household playback.', { exact: true }).waitFor()
    await b.locator('#movie-detail-play').click()
    try { await b.waitForFunction(() => Array.from(document.querySelectorAll('video')).some(v => !v.paused && v.currentTime > 0 && v.readyState >= 2), null, { timeout: 12000 }) } catch (error) { await b.screenshot({ path: resolve(projectRoot, 'artifacts/home-smoke/playback-failed.png') }); console.error(await b.evaluate(() => ({ text: document.body.innerText.slice(-2000), video: Array.from(document.querySelectorAll('video')).map(v => ({ src: v.currentSrc, paused: v.paused, ready: v.readyState, error: v.error?.message })) })), errors); throw error }
    await b.evaluate(() => { const video = Array.from(document.querySelectorAll('video')).find(v => !v.paused); video.currentTime = Math.min(50, video.duration / 2) })
    await b.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('xt_prefs') || '{}')).some(p => p.progVod?.['42']?.position > 40))
    await a.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('xt_prefs') || '{}')).some(p => p.progVod?.['42']?.position > 40), null, { timeout: 15000 })
    await b.evaluate(() => document.querySelectorAll('video').forEach(v => v.pause()))
  }
  assert.deepEqual(errors, [])
  console.log('PASS: two paired browsers, shared accounts, live progress sync, settings UI, responsive library' + (media ? ', media playback, seeking and progress round trip.' : '.'))
} finally {
  await browser.close(); await app.close(); provider.closeAllConnections(); await new Promise(done => provider.close(done)); await rm(dataDir, { recursive: true })
}

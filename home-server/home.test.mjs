import { test } from 'node:test'
import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { HomeStore } from './store.mjs'
import { sourceKey } from '../shared/home-protocol.mjs'
import { startServer } from './server.mjs'
import { mediaPath, mediaTarget, mediaRequest, rewriteHls, rewriteDash, safeTargetAddress } from './relay.mjs'

const source = { type: 'xtream', title: 'Fixture library', serverUrl: 'https://provider.example', username: 'fixture', password: 'fixture-password' }
const sourceId = sourceKey(source), sourceRow = `source/${sourceId}`, movieRow = `progress/${sourceId}/vod/42`
const progress = position => ({ position, duration: 1800, completed: false, name: 'Fixture movie' })
const op = (key, value, base, id) => ({ key, value, base, op: id.padEnd(12, '_') })
test('two devices merge different titles, stale offline updates lose, replay is idempotent, and deletion survives reconnect', () => {
  const store = new HomeStore(':memory:')
  try {
    const first = store.sync([op(sourceRow, source, 0, 'source')])
    assert.equal(first.rows.length, 1)
    const a = store.sync([op(movieRow, progress(90), 0, 'movie-a')], first.version)
    const b = store.sync([op(`progress/${sourceId}/episode/99`, progress(110), 0, 'episode-b')], first.version)
    assert.equal(b.rows.length, 2)
    const newer = store.sync([op(movieRow, progress(200), a.version, 'movie-new')])
    const stale = store.sync([op(movieRow, progress(100), a.version, 'movie-old')])
    assert.equal(stale.conflicts.length, 1)
    assert.equal(stale.rows.find(r => r.key === movieRow).value.position, 200)
    const replay = store.sync([op(movieRow, progress(200), a.version, 'movie-new')])
    assert.equal(replay.version, newer.version)
    store.sync([op(movieRow, null, newer.version, 'movie-clear')])
    assert.equal(store.sync([op(movieRow, progress(100), 0, 'offline')]).conflicts.length, 1)
    assert.equal(store.snapshot().rows.find(r => r.key === movieRow).value, null)
    assert.throws(() => store.sync([op(movieRow, progress(-1), 0, 'invalid')]))
  } finally { store.close() }
})
test('database and paired device survive restart; revoked token stops working', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lf-home-store-'))
  try {
    let store = new HomeStore(resolve(directory, 'home.sqlite'))
    const session = store.pair(store.code, 'Test phone', '192.168.1.2')
    store.sync([op(sourceRow, source, 0, 'source')]); store.close()
    store = new HomeStore(resolve(directory, 'home.sqlite'))
    assert.equal(store.authorize(session.token).name, 'Test phone')
    assert.equal(store.snapshot().rows[0].value.password, source.password)
    store.revoke(session.id); assert.equal(store.authorize(session.token), undefined)
    store.close()
  } finally { await rm(directory, { recursive: true }) }
})
test('pairing limits guesses and expires codes', () => {
  const store = new HomeStore(':memory:')
  try {
    for (let i = 0; i < 5; i++) assert.throws(() => store.pair('wrong', 'phone', 'a'), /incorrect/)
    assert.throws(() => store.pair(store.code, 'phone', 'a'), /Too many/)
    store.codeExpires = Date.now() - 1
    assert.throws(() => store.pair(store.code, 'phone', 'b'), /expired/)
  } finally { store.close() }
})
test('HTTP gate protects accounts, prevents rebinding/cross-site writes and rejects local metadata targets', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lf-home-http-'))
  await writeFile(resolve(directory, 'index.html'), '<html><head></head><body>Fixture UI</body></html>')
  const app = await startServer({ dataDir: directory, webRoot: directory, port: 0, mdns: false, runtime: false })
  const base = `http://127.0.0.1:${app.server.address().port}`
  const post = (path, data, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lanternfin-Home': '1', ...extra }, body: JSON.stringify(data) })
  try {
    assert.equal((await fetch(base + '/_home/state')).status, 401)
    assert.match(await (await fetch(base)).text(), /Household pairing code/)
    assert.equal((await post('/_home/pair', { code: app.store.code }, { Origin: 'http://evil.example' })).status, 403)
    assert.equal(await new Promise((done, reject) => { const req = http.get(base, { headers: { Host: `evil.example:${app.server.address().port}` } }, res => { res.resume(); done(res.statusCode) }); req.on('error', reject) }), 403)
    const paired = await post('/_home/pair', { code: app.store.code, name: 'Browser' })
    assert.equal(paired.status, 200)
    const cookie = paired.headers.get('set-cookie').split(';')[0]
    assert.equal((await paired.json()).token, undefined)
    assert.match(await (await fetch(base, { headers: { Cookie: cookie } })).text(), /__LANTERNFIN_HOME__/)
    assert.equal((await post('/_home/sync', { changes: [op(sourceRow, source, 0, 'http-source')], since: 0 }, { Cookie: cookie })).status, 200)
    assert.equal((await post('/_home/fetch', { url: 'http://169.254.169.254/latest/meta-data/' }, { Cookie: cookie })).status, 400)
    const native = await post('/_home/pair', { code: app.store.code, native: true }, { Origin: 'null' })
    const session = await native.json()
    assert.equal((await fetch(base + '/_home/state', { headers: { Authorization: `Bearer ${session.token}`, Origin: 'null' } })).status, 200)
    await post('/_home/revoke', { id: session.id }, { Cookie: cookie })
    assert.equal((await fetch(base + '/_home/state', { headers: { Authorization: `Bearer ${session.token}` } })).status, 401)
  } finally { await app.close(); await rm(directory, { recursive: true }) }
})
test('manifest relay preserves nested HLS and DASH segment addressing', () => {
  const base = 'https://provider.example/video/master.m3u8?token=secret'
  assert.equal(mediaTarget(mediaPath(base)), base)
  const hls = rewriteHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\nlow/playlist.m3u8\nhttps://cdn.example/part.ts', base)
  assert.match(hls, /URI="\/_home\/media\/https\/provider.example\/key"/)
  assert.match(hls, /\/_home\/media\/https\/cdn.example\/part.ts/)
  const dash = rewriteDash('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><SegmentTemplate media="segment-$Number$.m4s" initialization="https://cdn.example/init.mp4"/></AdaptationSet></Period></MPD>', 'https://provider.example/video/main.mpd')
  assert.match(dash, /<BaseURL>\/_home\/media\/https\/provider.example\/video\/main.mpd<\/BaseURL>/)
  assert.match(dash, /media="segment-\$Number\$.m4s"/)
  assert.match(dash, /initialization="\/_home\/media\/https\/cdn.example\/init.mp4"/)
  assert.throws(() => rewriteDash('<!DOCTYPE MPD><MPD/>', base))
  assert.equal(safeTargetAddress('127.0.0.1'), false)
  assert.equal(safeTargetAddress('169.254.169.254'), false)
  assert.equal(safeTargetAddress('192.168.1.50'), true)
  const context = { origin: 'https://provider.example', headers: { authorization: 'Basic fixture', 'user-agent': 'Fixture player' } }
  assert.equal(mediaRequest(mediaPath('https://provider.example/video/part.ts', context)).headers.authorization, 'Basic fixture')
  assert.equal(mediaRequest(mediaPath('https://cdn.example/part.ts', context)).headers.authorization, undefined)
  assert.equal(mediaRequest(mediaPath('https://cdn.example/part.ts', context)).headers['user-agent'], 'Fixture player')
})

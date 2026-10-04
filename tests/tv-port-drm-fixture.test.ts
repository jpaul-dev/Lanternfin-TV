// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDRMFixture, TEST_KID, TEST_KEY } from '../scripts/tv-drm-fixture.mjs'
import { parseCatalog } from '../tv-app/catalog'

let server: Server, directory: string, base: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lanternfin-drm-fixture-'))
  await writeFile(join(directory, 'manifest.mpd'), '<MPD/>'); await writeFile(join(directory, 'video-1.m4s'), 'test segment')
  let handle: ReturnType<typeof createDRMFixture>
  server = createServer((req, res) => { void handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  handle = createDRMFixture({ port, directory }); base = `http://127.0.0.1:${port}/_test/drm/`
})
afterEach(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  // Only this test's freshly allocated temporary directory is removed.
  if (directory.startsWith(join(tmpdir(), 'lanternfin-drm-fixture-'))) await rm(directory, { recursive: true, force: true })
})
const challenge = JSON.stringify({ kids: [Buffer.from(TEST_KID, 'hex').toString('base64url')], type: 'temporary' })
it('publishes playable parser metadata and separates CORS/media/license headers', async () => {
  const playlist = await (await fetch(base + 'playlist.m3u')).text(), catalog = parseCatalog(playlist, base)
  expect(catalog.channels).toHaveLength(5); expect(catalog.channels.every(channel => !channel.playback?.problem)).toBe(true)
  expect(new Set(catalog.channels.map(channel => channel.url)).size).toBe(5)
  expect(catalog.channels[0].playback?.drm?.clearKeys).toEqual({ [TEST_KID]: TEST_KEY })
  expect(catalog.channels[2].playback?.drm?.format).toEqual({ request: '{"challenge":"b{SSM}"}', response: 'JBlicense' })
  const preflight = await fetch(base + 'manifest.mpd', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'x-lanternfin-media' } })
  expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
  expect((await fetch(base + 'manifest.mpd', { headers: { 'X-Lanternfin-Media': 'demo-media' } })).status).toBe(200)
  expect((await fetch(base + 'video-1.m4s', { headers: { 'X-Lanternfin-Media': 'demo-media' } })).status).toBe(200)
  expect((await fetch(base + 'manifest.mpd')).status).toBe(403)
  expect((await fetch(base + 'manifest.mpd', { headers: { 'X-Lanternfin-Media': 'demo-media', 'X-Lanternfin-License': 'demo-license' } })).status).toBe(403)
  expect((await fetch(base + 'license', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'x-lanternfin-media' } })).status).toBe(403)
  expect(await (await fetch(base + 'status')).json()).toMatchObject({ manifest: 1, segments: 1, preflights: 1, rejected: 3 })
})
it('serves only the generated test key for valid raw/wrapped challenges and rejects header leaks or malformed requests', async () => {
  const send = (name: string, body: string, headers = { 'X-Lanternfin-License': 'demo-license' }) => fetch(base + name, { method: 'POST', headers, body })
  const raw = await (await send('license', challenge)).json()
  expect(raw).toEqual({ keys: [{ kty: 'oct', kid: Buffer.from(TEST_KID, 'hex').toString('base64url'), k: Buffer.from(TEST_KEY, 'hex').toString('base64url') }], type: 'temporary' })
  const wrapped = await (await send('license-wrapped', JSON.stringify({ challenge: Buffer.from(challenge).toString('base64') }))).json()
  expect(JSON.parse(Buffer.from(wrapped.license, 'base64').toString())).toEqual(raw)
  expect((await send('license', challenge, { 'X-Lanternfin-License': 'wrong' })).status).toBe(403)
  expect((await send('license', challenge, { 'X-Lanternfin-License': 'demo-license', 'X-Lanternfin-Media': 'demo-media' } as any)).status).toBe(403)
  expect((await send('license', '{"kids":["unknown"],"type":"temporary"}')).status).toBe(400)
  expect((await send('license-wrapped', '{"challenge":"not base64!"}')).status).toBe(400)
  expect((await send('license', 'x'.repeat(17000))).status).toBe(413)
  expect((await fetch(base + 'clear.mp4', { headers: { 'X-Lanternfin-Media': 'demo-media' } })).status).toBe(404)
  const status = await (await fetch(base + 'status')).text(); expect(status).not.toContain(TEST_KEY); expect(JSON.parse(status)).toMatchObject({ licenses: 1, wrappedLicenses: 1, rejected: 6 })
})

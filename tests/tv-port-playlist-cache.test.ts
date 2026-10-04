import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { CatalogCache } from '../tv-app/catalog-cache'
import { parseCatalog, type Catalog, type Source } from '../tv-app/catalog'
import { playlistChannel } from '../tv-app/playlist-cache-record'
import { sourceId } from '../tv-app/profiles'
import { channelId } from '../tv-app/library'

const source: Source = { kind: 'playlist', url: 'https://playlist.example/list.m3u?token=source-token', username: '', password: '' }
const playlist = (count = 1): Catalog => ({ channels: Array.from({ length: count }, (_, id) => ({ name: `Movie ${id}`, url: `https://media.example/movie/${id}.mp4?token=stream-token`, group: 'Movies', mediaKind: 'movie' })), skipped: 2, epgUrl: 'https://guide.example/list.xml?token=guide-token' })
afterEach(() => vi.restoreAllMocks())
async function inspect(factory: IDBFactory, action: (tx: IDBTransaction) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('lanternfin.tv.catalog.v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject })
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['meta', 'chunks'], 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = reject; action(tx) }) } finally { db.close() }
}
it('round-trips full M3U playback requirements, guide and catch-up data without changing stream identities', async () => {
  const input = parseCatalog(`#EXTM3U x-tvg-url="https://guide.example/guide.xml?token=guide-token"
#EXTINF:-1 tvg-id="channel" tvg-shift="1.5" group-title="News" catchup="default" catchup-days="7" catchup-correction="-2" catchup-source="https://archive.example/{utc}?token=archive-token",Tagged stream
#EXTVLCOPT:http-user-agent=required-agent
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_key=https://license.example/license|Authorization=Bearer%20license-token|b{SSM}|JBlicense
https://media.example/live.mpd|Authorization=Bearer%20media-token
#EXTINF:-1 tvg-type="movie",Clear Key
#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey
#KODIPROP:inputstream.adaptive.license_key=00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100
https://media.example/movie.mpd
#EXTINF:-1,Blocked format
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.license_key=https://license.example|Authorization=required|{SID}|R
https://media.example/blocked.mpd`, source.url)
  expect(input.channels[0].playback?.headers?.authorization).toBe('Bearer media-token')
  expect(input.channels[1].playback?.drm?.clearKeys).toBeDefined(); expect(input.channels[2].playback?.problem).toBeTruthy()
  const cache = new CatalogCache(new IDBFactory()); await cache.savePlaylist(source, input)
  const restored = await cache.loadPlaylist(source)
  expect(restored).toMatchObject(input); expect(restored?.channels.map(channelId)).toEqual(input.channels.map(channelId))
  expect(restored?.channels[0].playback?.drm?.headers).toEqual({ authorization: 'Bearer license-token' })
  expect(restored?.channels[0].catchupSource).toContain('{utc}')
  const clearKeys = { aabbccddeeff00112233445566778899: '0'.repeat(32), AABBCCDDEEFF00112233445566778899: '1'.repeat(32) }
  expect(() => playlistChannel({ ...input.channels[1], playback: { drm: { system: 'org.w3.clearkey', clearKeys } } })).toThrow('unavailable')
  expect(() => playlistChannel({ ...input.channels[1], playback: { drm: { ...input.channels[1].playback!.drm!, licenseUrl: 'https://license.example/' } } })).toThrow('unavailable')
})
it('stores and restores a compact playlist exceeding the former 8 MiB limit in bounded chunks', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), input = playlist(6000)
  for (const channel of input.channels) channel.url += 'x'.repeat(1500)
  expect(JSON.stringify(input).length).toBeGreaterThan(8 * 1024 * 1024)
  await cache.savePlaylist(source, input)
  const restored = await cache.loadPlaylist(source); expect(restored?.channels).toEqual(input.channels)
  await inspect(factory, tx => { const request = tx.objectStore('chunks').getAll(); request.onsuccess = () => { expect(request.result.length).toBeGreaterThan(12); expect(request.result.every(json => json.length <= 512 * 1024 && JSON.parse(json).length <= 500)).toBe(true) } })
})
it('expires after six hours, isolates sources and removes all playlist chunks on forgetting', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), other = { ...source, url: source.url + 'other' }
  await cache.savePlaylist(source, playlist()); await cache.savePlaylist(other, playlist(2))
  await inspect(factory, tx => { const request = tx.objectStore('meta').get(sourceId(source)); request.onsuccess = () => { const meta = JSON.parse(request.result); meta.at -= 7 * 3600000; tx.objectStore('meta').put(JSON.stringify(meta), sourceId(source)) } })
  expect(await cache.loadPlaylist(source)).toBeUndefined(); expect((await cache.loadPlaylist(other))?.channels).toHaveLength(2)
  await cache.forget(other); expect(await cache.loadPlaylist(other)).toBeUndefined()
  await inspect(factory, tx => { const request = tx.objectStore('chunks').count(); request.onsuccess = () => expect(request.result).toBe(0) })
})
it('retains the old playlist after a partially staged invalid replacement or quota failure', async () => {
  const cache = new CatalogCache(new IDBFactory()), original = playlist()
  await cache.savePlaylist(source, original)
  const broken = playlist(1001); broken.channels[800].playback = { headers: { Authorization: 'bad\nvalue' } }
  await expect(cache.savePlaylist(source, broken)).rejects.toThrow('unavailable')
  expect(await cache.loadPlaylist(source)).toMatchObject(original)
  const put = IDBObjectStore.prototype.put; let writes = 0
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) { if (this.name === 'chunks' && ++writes === 2) throw new DOMException('Full', 'QuotaExceededError'); return put.call(this, value, key) })
  await expect(cache.savePlaylist(source, playlist(1001))).rejects.toThrow('unavailable')
  expect(await cache.loadPlaylist(source)).toMatchObject(original)
})
it('rejects missing chunks and damaged playback metadata instead of dropping requirements', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory)
  await cache.savePlaylist(source, playlist())
  await inspect(factory, tx => { const request = tx.objectStore('chunks').openCursor(); request.onsuccess = () => { const item = request.result; if (item) { const rows = JSON.parse(item.value); rows[0].playback = { headers: 'Authorization=secret' }; item.update(JSON.stringify(rows)) } } })
  await expect(cache.loadPlaylist(source)).rejects.toThrow('unavailable')
  await cache.savePlaylist(source, playlist(501))
  await inspect(factory, tx => { const request = tx.objectStore('chunks').openCursor(); request.onsuccess = () => request.result?.delete() })
  await expect(cache.loadPlaylist(source)).rejects.toThrow('unavailable')
})
it('cancels cooperative restore and cannot recreate a playlist forgotten during saving', async () => {
  const cache = new CatalogCache(new IDBFactory()); await cache.savePlaylist(source, playlist(1001))
  const loading = new AbortController(); let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => { now += 20; if (now > 40) loading.abort(); return now })
  await expect(cache.loadPlaylist(source, loading.signal)).rejects.toThrow('cancelled')
  vi.restoreAllMocks()
  const saving = cache.savePlaylist(source, playlist(1001)).catch(error => error)
  await cache.forget(source); expect(await saving).toBeInstanceOf(Error); expect(await cache.loadPlaylist(source)).toBeUndefined()
})
it('keeps the old copy when publication is canceled and only allows the newest writer to publish', async () => {
  const cache = new CatalogCache(new IDBFactory()), original = playlist(), controller = new AbortController(), put = IDBObjectStore.prototype.put
  await cache.savePlaylist(source, original)
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) { const request = put.call(this, value, key); if (this.name === 'meta') request.addEventListener('success', () => controller.abort()); return request })
  await expect(cache.savePlaylist(source, playlist(600), controller.signal)).rejects.toThrow(); expect(await cache.loadPlaylist(source)).toMatchObject(original)
  vi.restoreAllMocks()
  const old = cache.savePlaylist(source, playlist(1001)).catch(error => error), latest = cache.savePlaylist(source, playlist(2))
  expect(await old).toBeInstanceOf(Error); await latest; expect((await cache.loadPlaylist(source))?.channels).toHaveLength(2)
})
it.each([
  { url: 'file:///private' }, { playback: { headers: { Bad: 'line\r\nbreak' } } }, { playback: { drm: { system: 'widevine', licenseUrl: 'javascript:alert(1)' } } },
  { playback: { drm: { system: 'clearkey', clearKeys: { bad: 'key' } } } }, { playback: { drm: { system: 'widevine', format: { response: 'JBlicense;HDCP' } } } },
  { playback: { ignoredRequirement: 'must not drop' } }, { catchupDays: Infinity }, { tvgShift: 25 }, { name: 'x'.repeat(201) }, { group: 'x'.repeat(101) },
])('rejects unsafe or unsupported cached record %#', override => {
  expect(() => playlistChannel({ ...playlist().channels[0], ...override })).toThrow('unavailable')
})

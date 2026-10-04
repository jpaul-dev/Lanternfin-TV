import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { CatalogCache, type CatalogSnapshot } from '../tv-app/catalog-cache'
import { ProviderIndex } from '../tv-app/provider-index'
import { sourceId } from '../tv-app/profiles'
import { mediaUrl } from '../tv-app/xtream'
import type { Source } from '../tv-app/catalog'
const source: Source = { kind: 'xtream', url: 'https://provider.example/sub', username: 'private-user', password: 'private-password' }
const snapshot = (account = source, count = 1201): CatalogSnapshot => ({ at: Date.now(), categories: { live: [{ id: '1', name: 'Live' }], movie: [], series: [] }, entries: [{ kind: 'live', category: { id: '1', name: 'Live' }, skipped: 2, channels: Array.from({ length: count }, (_, id) => ({ providerId: String(id), name: `Channel ${id}`, group: 'Live', mediaKind: 'live', url: mediaUrl(account, 'live', String(id), 'm3u8'), logo: 'https://art.example/logo.png', tvArchive: 1, tvArchiveDuration: 7 })) }] })
afterEach(() => vi.restoreAllMocks())
async function inspect(factory: IDBFactory, action: (tx: IDBTransaction) => void, mode: IDBTransactionMode = 'readonly') {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('lanternfin.tv.catalog.v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject })
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['meta', 'chunks'], mode); tx.oncomplete = () => resolve(); tx.onerror = reject; action(tx) }) } finally { db.close() }
}
it('restores a chunked whole-library index without copying account or stream credentials', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), input = snapshot()
  await cache.save(source, input)
  let raw = ''
  await inspect(factory, tx => { const request = tx.objectStore('chunks').getAll(); request.onsuccess = () => { raw = JSON.stringify(request.result) } })
  expect(raw).not.toMatch(/private-user|private-password|provider.example|\/live\//)
  const restored = await cache.load(source)
  expect(restored?.entries[0].channels).toEqual(input.entries[0].channels); expect(restored?.entries[0].skipped).toBe(2)
  const index = new ProviderIndex(source, []); await index.restore(restored!)
  expect(index.progress).toMatchObject({ complete: true, titles: 1201, loaded: 1 }); expect(index.cachedAt).toBe(input.at)
  expect(index.cached('live', input.categories.live[0])?.channels).toHaveLength(1201)
})
it('isolates sources and removes one or all saved catalogs', async () => {
  const cache = new CatalogCache(new IDBFactory()), other = { ...source, password: 'different' }
  await cache.save(source, snapshot(source, 1)); await cache.save(other, snapshot(other, 2))
  await cache.forget(source); expect(await cache.load(source)).toBeUndefined(); expect((await cache.load(other))?.entries[0].channels).toHaveLength(2)
  await cache.forget(); expect(await cache.load(other)).toBeUndefined()
})
it('expires stale data and rejects incomplete or oversized stored records', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), old = snapshot(source, 1); old.at -= 7 * 3600000
  await cache.save(source, old); expect(await cache.load(source)).toBeUndefined()
  await cache.save(source, snapshot(source, 1))
  await inspect(factory, tx => { const request = tx.objectStore('meta').get(sourceId(source)); request.onsuccess = () => { tx.objectStore('chunks').delete([sourceId(source), JSON.parse(request.result).generation, 0]) } }, 'readwrite')
  await expect(cache.load(source)).rejects.toThrow('unavailable')
  await inspect(factory, tx => { tx.objectStore('meta').put(JSON.stringify({ at: Date.now(), categories: {}, chunks: 1000000 }), sourceId(source)) }, 'readwrite')
  await expect(cache.load(source)).rejects.toThrow('unavailable')
})
async function keys(factory: IDBFactory) {
  let result: IDBValidKey[] = []
  await inspect(factory, tx => { const request = tx.objectStore('chunks').getAllKeys(); request.onsuccess = () => { result = request.result } })
  return result
}
it('keeps the last complete snapshot after a partially written replacement is invalid', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), original = snapshot(source, 1)
  await cache.save(source, original)
  const originalKeys = await keys(factory), invalid = snapshot(source, 1001)
  invalid.entries[0].channels[700].providerId = 'invalid provider id'
  await expect(cache.save(source, invalid)).rejects.toThrow('unavailable')
  expect(await cache.load(source)).toEqual(original); expect(await keys(factory)).toEqual(originalKeys)
  const incomplete = snapshot(source, 1); incomplete.categories.movie.push({ id: 'missing', name: 'Missing category' })
  await expect(cache.save(source, incomplete)).rejects.toThrow('unavailable'); expect(await cache.load(source)).toEqual(original)
})
it('retains the old catalog when a staged chunk exceeds storage quota', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), original = snapshot(source, 1)
  await cache.save(source, original); const originalKeys = await keys(factory)
  const put = IDBObjectStore.prototype.put; let writes = 0
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    if (this.name === 'chunks' && ++writes === 2) throw new DOMException('Storage full', 'QuotaExceededError')
    return put.call(this, value, key)
  })
  await expect(cache.save(source, snapshot())).rejects.toThrow('unavailable')
  expect(await cache.load(source)).toEqual(original); expect(await keys(factory)).toEqual(originalKeys)
})
it('rolls back publication and old-chunk removal when cancellation arrives during the final transaction', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), original = snapshot(source, 1201)
  await cache.save(source, original); const originalKeys = await keys(factory), controller = new AbortController()
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    const request = put.call(this, value, key)
    if (this.name === 'meta') request.addEventListener('success', () => controller.abort())
    return request
  })
  await expect(cache.save(source, snapshot(source, 1), controller.signal)).rejects.toThrow()
  expect(await cache.load(source)).toEqual(original); expect(await keys(factory)).toEqual(originalKeys)
})
it('publishes only the newest complete writer and preserves other source catalogs', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), newerCache = new CatalogCache(factory), other = { ...source, password: 'other-source' }
  await cache.save(source, snapshot(source, 1)); await cache.save(other, snapshot(other, 2))
  let replacement: Promise<void> | undefined
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    const request = put.call(this, value, key)
    if (this.name === 'chunks' && !replacement) request.addEventListener('success', () => { replacement = newerCache.save(source, snapshot(source, 600)) }, { once: true })
    return request
  })
  await expect(cache.save(source, snapshot())).rejects.toThrow(); await replacement
  expect((await cache.load(source))?.entries[0].channels).toHaveLength(600); expect((await cache.load(other))?.entries[0].channels).toHaveLength(2)
  expect(await keys(factory)).toHaveLength(3)
})
it('does not resurrect a source forgotten during a staged write', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory)
  await cache.save(source, snapshot(source, 1))
  let forgetting: Promise<void> | undefined; const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    const request = put.call(this, value, key)
    if (this.name === 'chunks' && !forgetting) request.addEventListener('success', () => { forgetting = cache.forget(source) }, { once: true })
    return request
  })
  await expect(cache.save(source, snapshot())).rejects.toThrow(); await forgetting
  expect(await cache.load(source)).toBeUndefined(); expect(await keys(factory)).toHaveLength(0)
})
it('loads legacy cache keys and replaces them only after a complete new save', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), original = snapshot(source, 600), id = sourceId(source)
  await cache.save(source, original)
  await inspect(factory, tx => {
    const meta = tx.objectStore('meta').get(id); meta.onsuccess = () => { const value = JSON.parse(meta.result); delete value.generation; tx.objectStore('meta').put(JSON.stringify(value), id) }
    const cursor = tx.objectStore('chunks').openCursor(); cursor.onsuccess = () => { const item = cursor.result; if (item) { const key = item.key as IDBValidKey[]; tx.objectStore('chunks').put(item.value, [id, key[2]]); item.delete(); item.continue() } }
  }, 'readwrite')
  expect(await cache.load(source)).toEqual(original)
  const invalid = snapshot(source, 1001); invalid.entries[0].channels[700].providerId = 'invalid provider id'
  await expect(cache.save(source, invalid)).rejects.toThrow(); expect(await cache.load(source)).toEqual(original)
  await cache.save(source, snapshot(source, 1)); expect((await cache.load(source))?.entries[0].channels).toHaveLength(1)
  const remaining = await keys(factory); expect(remaining).toHaveLength(1); expect((remaining[0] as IDBValidKey[])).toHaveLength(3)
})
it('reclaims abandoned staging and preserves the published copy if the next save fails', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), original = snapshot(source, 1), id = sourceId(source)
  await cache.save(source, original); const originalKeys = await keys(factory)
  await inspect(factory, tx => { tx.objectStore('chunks').put('abandoned', [id, 'f'.repeat(32), 0]); tx.objectStore('chunks').put('old legacy', [id, 0]) }, 'readwrite')
  const invalid = snapshot(source, 1001); invalid.entries[0].channels[700].providerId = 'invalid provider id'
  await expect(cache.save(source, invalid)).rejects.toThrow(); expect(await cache.load(source)).toEqual(original); expect(await keys(factory)).toEqual(originalKeys)
  await inspect(factory, tx => { tx.objectStore('chunks').put('abandoned', [id, 'f'.repeat(32), 0]) }, 'readwrite')
  await cache.forget(source); expect(await keys(factory)).toHaveLength(0)
})
it('does not publish staging that another writer or storage failure made incomplete', async () => {
  const factory = new IDBFactory(), cache = new CatalogCache(factory), original = snapshot(source, 1)
  await cache.save(source, original); const originalKeys = await keys(factory), put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    const request = put.call(this, value, key)
    if (this.name === 'chunks' && Array.isArray(key) && key.length === 3 && key[2] === 2) request.addEventListener('success', () => { this.delete([key[0], key[1], 0]) })
    return request
  })
  await expect(cache.save(source, snapshot())).rejects.toThrow('unavailable')
  expect(await cache.load(source)).toEqual(original); expect(await keys(factory)).toEqual(originalKeys)
})
it('cannot resurrect cached credentials or titles after forgetting or cancellation', async () => {
  const cache = new CatalogCache(new IDBFactory()), input = snapshot()
  const saving = cache.save(source, input).catch(error => error)
  await cache.forget(source); expect(await saving).toBeInstanceOf(Error); expect(await cache.load(source)).toBeUndefined()
  const controller = new AbortController(); controller.abort()
  await expect(cache.save(source, input, controller.signal)).rejects.toThrow('cancelled')
  expect(await cache.load(source)).toBeUndefined()
})

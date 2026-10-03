import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { expect, it } from 'vitest'
import { CatalogCache, type CatalogSnapshot } from '../tv-app/catalog-cache'
import { ProviderIndex } from '../tv-app/provider-index'
import { sourceId } from '../tv-app/profiles'
import { mediaUrl } from '../tv-app/xtream'
import type { Source } from '../tv-app/catalog'
const source: Source = { kind: 'xtream', url: 'https://provider.example/sub', username: 'private-user', password: 'private-password' }
const snapshot = (account = source, count = 1201): CatalogSnapshot => ({ at: Date.now(), categories: { live: [{ id: '1', name: 'Live' }], movie: [], series: [] }, entries: [{ kind: 'live', category: { id: '1', name: 'Live' }, skipped: 2, channels: Array.from({ length: count }, (_, id) => ({ providerId: String(id), name: `Channel ${id}`, group: 'Live', mediaKind: 'live', url: mediaUrl(account, 'live', String(id), 'm3u8'), logo: 'https://art.example/logo.png', tvArchive: 1, tvArchiveDuration: 7 })) }] })
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
  const index = new ProviderIndex(source, []); index.restore(restored!)
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
  await inspect(factory, tx => { tx.objectStore('chunks').delete([sourceId(source), 0]) }, 'readwrite')
  await expect(cache.load(source)).rejects.toThrow('unavailable')
  await inspect(factory, tx => { tx.objectStore('meta').put(JSON.stringify({ at: Date.now(), categories: {}, chunks: 1000000 }), sourceId(source)) }, 'readwrite')
  await expect(cache.load(source)).rejects.toThrow('unavailable')
})
it('cannot resurrect cached credentials or titles after forgetting or cancellation', async () => {
  const cache = new CatalogCache(new IDBFactory()), input = snapshot()
  const saving = cache.save(source, input).catch(error => error)
  await cache.forget(source); expect(await saving).toBeInstanceOf(Error); expect(await cache.load(source)).toBeUndefined()
  const controller = new AbortController(); controller.abort()
  await expect(cache.save(source, input, controller.signal)).rejects.toThrow('cancelled')
  expect(await cache.load(source)).toBeUndefined()
})

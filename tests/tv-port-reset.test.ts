// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { CatalogCache } from '../tv-app/catalog-cache'
import { resetAppData } from '../tv-app/reset'

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('clears every portable app key and its real catalog stores while retaining other apps and downloads', async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  const cache = new CatalogCache(new IDBFactory()), source = { kind: 'xtream' as const, url: 'https://example.test', username: 'name', password: 'secret' }
  await cache.save(source, { at: Date.now(), categories: { live: [], movie: [], series: [] }, entries: [] })
  for (const key of ['lanternfin.tv.source.v1', 'lanternfin.tv.profiles.v1', 'lanternfin.tv.library.v1.abc', 'lanternfin.tv.preferences.v1', 'lanternfin.tv.future.v2']) localStorage.setItem(key, 'private')
  localStorage.setItem('other.app', 'keep'); localStorage.setItem('lanternfin.downloads.v1', 'keep')
  sessionStorage.setItem('lanternfin.restored', '2'); sessionStorage.setItem('other.session', 'keep')
  await resetAppData(localStorage, sessionStorage, cache)
  expect(localStorage.length).toBe(2); expect(localStorage.getItem('other.app')).toBe('keep'); expect(localStorage.getItem('lanternfin.downloads.v1')).toBe('keep')
  expect(sessionStorage.length).toBe(1); expect(sessionStorage.getItem('other.session')).toBe('keep')
  expect(await cache.load(source)).toBeUndefined()
})

it('waits for download cleanup before clearing catalogs or account data, and leaves them when it fails', async () => {
  localStorage.setItem('lanternfin.tv.source.v1', 'saved')
  const cache = { forget: vi.fn(async () => {}) }, remove = vi.fn(async () => { throw new Error('unconfirmed native transfer') })
  await expect(resetAppData(localStorage, sessionStorage, cache, remove)).rejects.toThrow()
  expect(cache.forget).not.toHaveBeenCalled(); expect(localStorage.getItem('lanternfin.tv.source.v1')).toBe('saved')
  remove.mockImplementation(async () => { expect(localStorage.getItem('lanternfin.tv.source.v1')).toBe('saved') })
  await resetAppData(localStorage, sessionStorage, cache, remove)
  expect(cache.forget).toHaveBeenCalledOnce(); expect(localStorage.getItem('lanternfin.tv.source.v1')).toBeNull()
})

it('propagates storage and cache failures instead of reporting a successful reset', async () => {
  localStorage.setItem('lanternfin.tv.preferences.v1', 'saved')
  await expect(resetAppData(localStorage, sessionStorage, { forget: async () => { throw new Error('IDB unavailable') } })).rejects.toThrow('IDB')
  expect(localStorage.getItem('lanternfin.tv.preferences.v1')).toBe('saved')
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {})
  await expect(resetAppData(localStorage, sessionStorage, { forget: async () => {} })).rejects.toThrow('did not remove')
})

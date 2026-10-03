// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { providerTimestamp, catalogTimestamp } from '../tv-app/provider-date'
import { NewestTitles } from '../tv-app/discovery'
import { homeRows, cardChannel, cardVersions } from '../tv-app/presentation'
import { sortCatalog } from '../tv-app/sort'
import { loadCategory, mediaUrl } from '../tv-app/xtream'
import { CatalogCache } from '../tv-app/catalog-cache'
import { channelReference, referenceChannel } from '../tv-app/provider-reference'
import type { Channel, Source } from '../tv-app/catalog'

const now = 1791040000000, source: Source = { kind: 'xtream', url: 'https://provider.example', username: 'name', password: 'secret' }
const channel = (id: number, addedAt?: number, mediaKind: 'movie' | 'series' = 'movie'): Channel => ({ name: `Title ${id}`, url: mediaKind === 'series' ? '' : mediaUrl(source, mediaKind, String(id), 'mp4'), group: 'Movies', providerId: String(id), mediaKind, ...(addedAt ? { addedAt } : {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('normalizes epoch dates without inventing a date or accepting malformed or future values', () => {
  expect(providerTimestamp(String(now / 1000), now)).toBe(now)
  expect(providerTimestamp(now, now)).toBe(now)
  expect(providerTimestamp(' 1 ', now)).toBe(1000)
  expect(catalogTimestamp(1000, now)).toBe(1000)
  for (const value of [undefined, null, true, [], {}, '', '1e9', '2026-01-01', 0, -1, 0.5, Infinity, NaN, now + 86400001, 1e15]) expect(providerTimestamp(value, now)).toBeUndefined()
  expect(catalogTimestamp('1000', now)).toBeUndefined()
})

it('uses provider additions and a series update fallback without treating release dates as additions', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
    { stream_id: 1, series_id: 1, added: String(now / 1000), last_modified: now - 86400000 },
    { stream_id: 2, series_id: 2, added: 'invalid', last_modified: now - 86400000 },
    { stream_id: 3, series_id: 3, releaseDate: '2026-01-01' },
    { stream_id: 4, series_id: 4, added: 1e15 },
  ]))))
  const category = { id: '1', name: 'Films' }, signal = new AbortController().signal
  expect((await loadCategory(source, 'movie', category, signal)).channels.map(item => item.addedAt)).toEqual([now, undefined, undefined, undefined])
  expect((await loadCategory(source, 'series', category, signal)).channels.map(item => item.addedAt)).toEqual([now, now - 86400000, undefined, undefined])
  expect((await loadCategory(source, 'live', category, signal)).channels.every(item => item.addedAt === undefined)).toBe(true)
})

it('preserves dates through bounded references and the saved provider catalog', async () => {
  const movie = channel(1, now), early = channel(2, 1000), legacy = channel(3)
  expect(referenceChannel(source, channelReference(source, early)!)).toEqual(early)
  const cache = new CatalogCache(new IDBFactory()), category = { id: '1', name: 'Movies' }
  await cache.save(source, { at: Date.now(), categories: { live: [], movie: [category], series: [] }, entries: [{ kind: 'movie', category, channels: [movie, early, legacy], skipped: 0 }] })
  expect((await cache.load(source))?.entries[0].channels).toEqual([movie, early, legacy])
})

it('keeps twelve distinct newest titles with stable ties and bounded duplicate updates', () => {
  const list = new NewestTitles()
  for (let id = 0; id < 5000; id++) list.add(channel(id, now - (5000 - id) * 1000))
  expect(list.channels).toHaveLength(12); expect(list.channels[0].providerId).toBe('4999')
  list.add(channel(4999, now)); expect(list.channels).toHaveLength(12)
  list.add(channel(1, now)); expect(list.channels.slice(0, 2).map(item => item.providerId)).toEqual(['4999', '1'])
  list.add(channel(2)); expect(list.channels).toHaveLength(12)
})

it('renders separate rails using only dated movies and series, with working version actions', async () => {
  const root = document.createElement('div'), activate = vi.fn(); document.body.replaceChildren(root)
  const english = { ...channel(1, now), name: 'EN - Example (2026)' }, french = { ...channel(2, now - 86400000), name: 'FR - Example (2026)' }
  const other = channel(3, now - 1000), series = channel(4, now, 'series'), missing = channel(5)
  await homeRows(root, [french, other, english, series, missing], undefined, activate, 'fr', ['new-series', 'new-movies'])
  expect([...root.querySelectorAll('h2')].map(node => node.textContent)).toEqual(['Recently added series', 'Recently added movies'])
  const movies = root.querySelectorAll<HTMLButtonElement>('[data-row="Recently added movies"] button')
  expect([...movies].map(cardChannel)).toEqual([french, other]); expect(cardVersions(movies[0])).toEqual([french, english])
  movies[0].click(); expect(activate).toHaveBeenLastCalledWith(french, [french, english])
  expect(french.addedAt).toBe(now - 86400000)
  await homeRows(root, [missing], undefined, activate, undefined, ['new-movies', 'new-series']); expect(root.children).toHaveLength(0)
})

it('sorts dated titles first, keeping provider order for equal and missing dates', async () => {
  const items = [channel(1), channel(2, now - 1000), channel(3, now), channel(4, now), channel(5)]
  expect((await sortCatalog(items, 'newest', new AbortController().signal)).map(item => item.providerId)).toEqual(['3', '4', '2', '1', '5'])
  expect(items.map(item => item.providerId)).toEqual(['1', '2', '3', '4', '5'])
})

it('cancels a large newest-first sort without mutating the provider array', async () => {
  const items = Array.from({ length: 20000 }, (_, id) => channel(id, now - id * 1000)), controller = new AbortController()
  let elapsed = 0; vi.spyOn(performance, 'now').mockImplementation(() => elapsed += 20)
  const pending = sortCatalog(items, 'newest', controller.signal); controller.abort()
  await expect(pending).rejects.toThrow('cancelled'); expect(items[0].providerId).toBe('0')
})

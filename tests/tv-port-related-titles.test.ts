// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { titleRating, titleYear, titleMetadata } from '../tv-app/title-metadata'
import { relatedTitles } from '../tv-app/related-titles'
import { channelReference, referenceChannel } from '../tv-app/provider-reference'
import { loadCategory, mediaUrl } from '../tv-app/xtream'
import { CatalogCache } from '../tv-app/catalog-cache'
import { ProviderIndex } from '../tv-app/provider-index'
import { channelCard } from '../tv-app/presentation'
import type { Channel, Source } from '../tv-app/catalog'

const source: Source = { kind: 'xtream', url: 'https://provider.example', username: 'demo', password: 'demo' }
const signal = () => new AbortController().signal
const movie = (id: number, rating?: number): Channel => ({ name: `Movie ${id}`, group: 'Drama', mediaKind: 'movie', providerId: String(id), categoryId: '1', url: mediaUrl(source, 'movie', String(id), 'mp4'), ...(rating ? { rating } : {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('normalizes provider facts without treating malformed values as ratings or years', () => {
  expect(titleRating('8.43', '2')).toBe(8.4); expect(titleRating('', '4.25')).toBe(8.5)
  expect(titleYear('2024-01-01')).toBe('2024'); expect(titleYear(1896)).toBe('1896')
  for (const value of [true, [], {}, Infinity, NaN, -1, 0, '10 / 10', '1e1', '<b>8</b>']) expect(titleRating(value)).toBeUndefined()
  expect(titleRating(11, 6)).toBeUndefined(); expect(titleYear('2024<script>')).toBeUndefined()
  expect(titleMetadata({ categoryId: '../1', rating: true, year: 'large' })).toEqual({})
})

it('preserves ratings, years and exact category IDs through loading, bookmarks and cached catalogs', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ stream_id: 1, name: 'One', rating_5based: '4.5', releaseDate: '2020-02-10', category_id: 'different' }]))))
  const category = { id: '1', name: 'Drama' }, loaded = (await loadCategory(source, 'movie', category, signal())).channels[0]
  expect(loaded).toMatchObject({ rating: 9, year: '2020', categoryId: '1' })
  const restored = referenceChannel(source, channelReference(source, loaded)!)
  expect(restored).toMatchObject({ rating: 9, year: '2020', categoryId: '1' })
  const cache = new CatalogCache(new IDBFactory())
  await cache.save(source, { at: Date.now(), categories: { live: [], movie: [category], series: [] }, entries: [{ kind: 'movie', category, channels: [loaded], skipped: 0 }] })
  const snapshot = (await cache.load(source))!, index = new ProviderIndex(source, [])
  await index.restore(snapshot)
  expect(index.categoryItems({ ...restored, categoryId: undefined })).toEqual(snapshot.entries[0].channels)
  const card = channelCard(restored, vi.fn())
  expect(card.querySelector('small')?.textContent).toBe('2020 · 9.0 / 10 · Drama')
})

it('returns twelve distinct highest rated category matches with stable provider-order ties', async () => {
  const current = movie(0, 10), pool = Array.from({ length: 10000 }, (_, id) => movie(id, (id % 10) + 1))
  pool.unshift({ ...movie(10001, 10), categoryId: '2' }, { ...movie(10002, 10), mediaKind: 'series' })
  pool.push(movie(9, 10)); const original = [...pool]
  const result = await relatedTitles(current, pool, 'xtream', undefined, signal())
  expect(result).toHaveLength(12); expect(result.map(item => item.channel.providerId)).toEqual(Array.from({ length: 12 }, (_, i) => String(i * 10 + 9)))
  expect(pool).toEqual(original)
  expect(await relatedTitles({ ...movie(0), categoryId: undefined }, [movie(0), movie(1)], 'xtream', undefined, signal())).toEqual([{ channel: movie(1) }])
  expect(await relatedTitles({ ...movie(0), categoryId: undefined }, [movie(1)], 'xtream', undefined, signal())).toEqual([])
})

it('keeps language groups local and excludes all versions of the current title when grouping is enabled', async () => {
  const current = { ...movie(0), name: 'EN - Current (2020)' }, currentFR = { ...movie(1), name: 'FR - Current (2020)' }
  const otherEN = { ...movie(2, 8), name: 'EN - Other (2021)' }, otherFR = { ...movie(3, 9), name: 'FR - Other (2021)' }
  const outside = { ...movie(4, 10), name: 'DE - Other (2021)', categoryId: '2' }
  const pool = [current, currentFR, otherEN, otherFR, outside]
  const result = await relatedTitles(current, pool, 'xtream', 'fr', signal())
  expect(result).toEqual([{ channel: otherFR, versions: [otherEN, otherFR] }])
  expect((await relatedTitles(current, pool, 'xtream', undefined, signal())).map(item => item.channel)).toEqual([otherFR, otherEN, currentFR])
})

it('uses playlist groups without guessing relatedness from title text and supports series', async () => {
  const current = { ...movie(0), categoryId: undefined, mediaKind: 'series' as const }
  const one = { ...movie(1), mediaKind: 'series' as const }, unrelated = { ...movie(2), name: current.name, group: 'Other', mediaKind: 'series' as const }
  expect(await relatedTitles(current, [one, unrelated, movie(3)], 'playlist', undefined, signal())).toEqual([{ channel: one }])
  expect(await relatedTitles({ ...current, mediaKind: 'live' }, [one], 'playlist', undefined, signal())).toEqual([])
})

it('yields and cancels large scans before publishing partial suggestions', async () => {
  const controller = new AbortController(), pool = Array.from({ length: 20000 }, (_, id) => movie(id))
  let elapsed = 0; vi.spyOn(performance, 'now').mockImplementation(() => elapsed += 20)
  const pending = relatedTitles(pool[0], pool, 'xtream', undefined, controller.signal)
  controller.abort(); await expect(pending).rejects.toThrow('canceled')
  expect(pool).toHaveLength(20000)
})

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ProviderIndex } from '../tv-app/provider-index'
import { providerGroups, providerResolver } from '../tv-app/provider-browsing'
import { searchCatalog } from '../tv-app/search'
import { homeRows, cardChannel, cardVersions } from '../tv-app/presentation'
import { LiveQueue } from '../tv-app/playback-queue'
import { channelId, TVLibrary } from '../tv-app/library'
import type { Channel, Source } from '../tv-app/catalog'
import type { CatalogSnapshot } from '../tv-app/catalog-cache'
import type { MediaKind } from '../tv-app/xtream'

const source: Source = { kind: 'xtream', url: 'https://example.test', username: 'demo', password: 'demo' }
const categories = [{ id: '1', name: 'Everything' }, { id: '2', name: 'Sports' }, { id: '3', name: 'Sports' }]
const title = (kind: MediaKind, category: number, id = '7', name = 'Shared'): Channel => ({ mediaKind: kind, providerId: id, categoryId: String(category), group: categories[category - 1].name, name, url: `https://example.test/${kind}/${id}` })
const snapshot = (...channels: Channel[]): CatalogSnapshot => ({ at: Date.now(), categories: { live: categories, movie: categories, series: categories }, entries: channels.map(channel => ({ kind: channel.mediaKind as MediaKind, category: categories[Number(channel.categoryId) - 1], channels: [channel], skipped: 0 })) })
const load = async (...channels: Channel[]) => { const index = new ProviderIndex(source, []); await index.restore(snapshot(...channels)); return index }
const signal = () => new AbortController().signal
const allowed = (_kind: MediaKind, id: string) => !!id && id !== '1'
afterEach(() => vi.restoreAllMocks())

it('resolves actual visible records without changing playback identity or conflating names and media kinds', async () => {
  const hidden = title('live', 1), visible = title('live', 2), other = title('live', 3, '8'), movie = title('movie', 2)
  const index = await load(hidden, visible, other, movie), resolve = providerResolver(index, allowed)
  expect(index.items).toEqual([hidden, other, movie]); expect(resolve(hidden)).toBe(visible)
  expect(channelId(resolve(hidden)!)).toBe(channelId(hidden)); expect(hidden.group).toBe('Everything')
  expect(await providerGroups(index.items, index, allowed, signal())).toEqual([
    { id: 'live:2', name: 'Sports · Live TV · 2' }, { id: 'live:3', name: 'Sports · Live TV · 3' }, { id: 'movie:2', name: 'Sports · Movies' },
  ])
  expect(await searchCatalog(index.items, '', '', signal(), undefined, providerResolver(index, allowed, 'live:2'))).toEqual([visible])
  expect(await searchCatalog(index.items, '', '', signal(), undefined, providerResolver(index, allowed, 'movie:2'))).toEqual([movie])
  expect(await searchCatalog(index.items, '', '', signal(), undefined, providerResolver(index, allowed, 'removed:2'))).toEqual([])
})

it('enriches old bookmarks only at the same URL and keeps episode identity while resolving the parent series', async () => {
  const hidden = title('live', 1), visible = title('live', 2), series = title('series', 1), seriesVisible = title('series', 2)
  const index = await load(hidden, visible, series, seriesVisible), resolve = providerResolver(index, allowed)
  expect(resolve({ ...hidden, categoryId: undefined })).toBe(visible)
  expect(resolve({ ...hidden, url: 'https://example.test/different' })).toBeUndefined()
  expect(resolve({ ...hidden, categoryId: undefined, url: 'https://example.test/different' })).toBeUndefined()
  const episode: Channel = { ...series, mediaKind: 'episode', seriesId: '7', providerId: 'episode-1', name: 'Episode One', group: 'Season 1', url: 'https://example.test/episode/1' }
  expect(resolve(episode)).toBe(episode)
  expect(providerResolver(index, () => false)(episode)).toBeUndefined()
  expect(await providerGroups([episode], index, allowed, signal())).toEqual([{ id: 'series:2', name: 'Sports · Series' }])
  expect(await providerGroups([episode], undefined, allowed, signal())).toEqual([])
})

it('preserves selected membership context and takes complete names from the provider directory', async () => {
  const first = title('live', 2), second = title('live', 3)
  const index = await load(first, second)
  expect(providerResolver(index, allowed)(second)).toBe(second)
  expect(providerResolver(index, allowed, 'live:2')(second)).toBe(first)
  expect(await providerGroups([{ ...first, group: 'Truncated bookmark label' }], index, allowed, signal())).toEqual([
    { id: 'live:2', name: 'Sports · Live TV · 2' }, { id: 'live:3', name: 'Sports · Live TV · 3' },
  ])
})

it('uses visible records for language groups, saved Home cards and channel switching', async () => {
  const en = title('movie', 1, '1', 'EN - Shared'), fr = title('movie', 1, '2', 'FR - Shared')
  const enVisible = { ...en, categoryId: '2', group: 'Sports' }, frVisible = { ...fr, categoryId: '2', group: 'Sports' }
  const live = title('live', 1), liveVisible = title('live', 2), next = title('live', 3, '8')
  const index = await load(en, fr, enVisible, frVisible, live, liveVisible, next), resolve = providerResolver(index, allowed)
  const root = document.createElement('div'), library = new TVLibrary(null, source); library.toggleFavorite(fr)
  await homeRows(root, index.items, library, () => {}, 'fr', ['movies','favorites'], [], undefined, resolve)
  const movie = root.querySelector<HTMLElement>('[data-row-id="movies"] .channel')!
  expect(cardChannel(movie)).toBe(frVisible); expect(cardVersions(movie)).toEqual([enVisible, frVisible])
  expect(root.textContent).not.toContain('Everything'); expect(root.querySelector('[data-row-id="favorites"]')?.textContent).toContain('FR - Shared')
  const queue = new LiveQueue(); queue.reset([...index.items, liveVisible], live, undefined, resolve)
  expect(queue.length).toBe(2); expect(queue.tune('1')).toBe(liveVisible); expect(queue.step(1)).toBe(next)
})

it('does not publish an over-budget secondary membership and can retry it', async () => {
  const hidden = title('live', 1), visible = title('live', 2)
  let failed = true
  const index = new ProviderIndex(source, categories.slice(0, 2), { categories: async () => [], category: async (_source, _kind, category) => ({ channels: [category.id === '1' ? hidden : failed ? { ...visible, description: 'x'.repeat(5000) } : visible], skipped: 0 }) }, { records: 10, characters: 1000 })
  await index.start(() => {}); expect(index.progress.message).toContain('memory budget')
  expect(providerResolver(index, allowed)(hidden)).toBeUndefined()
  failed = false; await index.start(() => {}); expect(providerResolver(index, allowed)(hidden)).toBe(visible)
  const restored = new ProviderIndex(source, []); await restored.restore(index.snapshot()!)
  expect(providerResolver(restored, allowed)(restored.items[0])?.group).toBe('Sports')
})

it('keeps secondary memberships private until their category finishes staging', async () => {
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 20)
  const hidden = title('live', 1), visible = title('live', 2)
  const index = new ProviderIndex(source, categories.slice(0, 2), { categories: async () => [], category: async (_source, _kind, category) => {
    if (category.id === '1') return { channels: [hidden], skipped: 0 }
    setTimeout(() => index.pause(), 0)
    return { channels: Array.from({ length: 2048 }, () => visible), skipped: 0 }
  } })
  await index.start(() => {})
  expect(index.items).toEqual([hidden]); expect(index.progress.complete).toBe(false)
  expect(providerResolver(index, allowed)(hidden)).toBeUndefined()
  expect(index.cached('live', categories[1])).toBeUndefined()
})

it('yields during a large group scan and cancels before returning stale results', async () => {
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 20)
  const request = new AbortController(), items = Array.from({ length: 20000 }, (_, id) => title('live', 2, String(id)))
  const pending = providerGroups(items, undefined, allowed, request.signal); request.abort()
  await expect(pending).rejects.toThrow('cancelled')
  const search = new AbortController(), searching = searchCatalog(items, '', '', search.signal, undefined, () => undefined); search.abort()
  await expect(searching).rejects.toThrow('cancelled')
})

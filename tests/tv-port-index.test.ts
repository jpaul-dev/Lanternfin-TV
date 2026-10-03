import { expect, it, vi } from 'vitest'
import { ProviderIndex } from '../tv-app/provider-index'
import type { Source, Channel } from '../tv-app/catalog'
const source: Source = { kind: 'xtream', url: 'https://example.com', username: 'u', password: 'p' }
const categories = [{ id: '1', name: 'First' }, { id: '2', name: 'Second' }]
it('indexes every media kind, deduplicates shared titles and reuses completed categories', async () => {
  const loader = { categories: vi.fn(async () => categories), category: vi.fn(async (_s, kind, category) => ({ channels: [{ name: category.name, group: category.name, url: 'https://example.com/a', mediaKind: kind, providerId: '1' }] as Channel[], skipped: 0 })) }
  const index = new ProviderIndex(source, categories, loader)
  await index.start(() => {})
  expect(index.items.map(item => item.mediaKind)).toEqual(['live', 'movie', 'series'])
  expect(index.progress).toMatchObject({ loaded: 6, total: 6, complete: true, titles: 3 })
  await index.start(() => {}); expect(loader.category).toHaveBeenCalledTimes(6)
  expect(index.cached('movie', categories[0])?.channels[0].name).toBe('First')
})
it('keeps a partial library and retries only failed categories', async () => {
  let fail = true
  const loader = { categories: async () => [], category: vi.fn(async (_s, _kind, category) => {
    if (fail && category.id === '2') throw new Error('Provider unavailable')
    return { channels: [{ name: category.name, group: '', url: 'https://example.com/' + category.id, mediaKind: 'live', providerId: category.id }] as Channel[], skipped: 0 }
  }) }
  const index = new ProviderIndex(source, categories, loader)
  await index.start(() => {}); expect(index.progress).toMatchObject({ complete: false, failed: 1, titles: 1 })
  fail = false; await index.start(() => {}); expect(index.progress.complete).toBe(true); expect(loader.category).toHaveBeenCalledTimes(3)
})
it('does not publish a late response after cancellation', async () => {
  let release!: (value: { channels: Channel[]; skipped: number }) => void
  const index = new ProviderIndex(source, categories, { categories: async () => [], category: async () => new Promise(resolve => { release = resolve }) })
  const loading = index.start(() => {}); index.pause()
  release({ channels: [{ name: 'Late', group: '', url: 'https://example.com' }], skipped: 0 }); await loading
  expect(index.items).toEqual([]); expect(index.progress.running).toBe(false)
})
it('stops at the memory budget without claiming the search covers all titles', async () => {
  const index = new ProviderIndex(source, categories, { categories: async () => [], category: async () => ({ channels: [{ name: 'Large', group: '', url: 'https://example.com' }], skipped: 0 }) }, { records: 0, characters: 10 })
  await index.start(() => {}); expect(index.progress.complete).toBe(false)
  expect(index.progress.message).toContain('memory budget'); expect(index.items).toEqual([])
})

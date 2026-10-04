import { expect, it, vi } from 'vitest'
import { ProviderIndex } from '../tv-app/provider-index'
import type { Source, Channel } from '../tv-app/catalog'
import type { CatalogSnapshot } from '../tv-app/catalog-cache'
const source: Source = { kind: 'xtream', url: 'https://example.com', username: 'u', password: 'p' }
const categories = [{ id: '1', name: 'First' }, { id: '2', name: 'Second' }]
it('retains all memberships for duplicated titles after indexing and saved-catalog restore', async () => {
  const loader = { categories: async () => [], category: async (_s: Source, kind: 'live' | 'movie' | 'series', category: { id: string; name: string }) => ({ channels: [{ name: 'Shared', group: category.name, categoryId: category.id, url: 'https://example.com/shared', mediaKind: kind, providerId: '1' }] as Channel[], skipped: 0 }) }
  const index = new ProviderIndex(source, categories, loader); await index.start(() => {})
  expect(index.items).toHaveLength(1); expect([...index.categoryOf(index.items[0])!]).toEqual(['1','2'])
  const restored = new ProviderIndex(source, []); await restored.restore(index.snapshot()!)
  expect([...restored.categoryOf(restored.items[0])!]).toEqual(['1','2'])
})
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

const saved = (count: number): CatalogSnapshot => ({ at: Date.now(), categories: { live: categories.slice(0, 1), movie: [], series: [] }, entries: [{ kind: 'live', category: categories[0], skipped: 0, channels: Array.from({ length: count }, (_, id) => ({ name: `Channel ${id}`, group: 'Live', url: `https://example.test/${id}.m3u8`, mediaKind: 'live', providerId: String(id) })) }] })

it('yields while restoring a large saved category and publishes it only when complete', async () => {
  let clock = 0
  const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock += 20)
  try {
    const input = saved(50000), index = new ProviderIndex(source, [])
    const pending = index.restore(input)
    expect(index.items).toHaveLength(0); expect(index.progress.complete).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(index.items).toHaveLength(0)
    await pending
    expect(index.items).toHaveLength(50000); expect(index.progress.complete).toBe(true)
    expect(index.has({ ...input.entries[0].channels[49999] })).toBe(true)
    expect(index.has({ ...input.entries[0].channels[49999], url: 'https://example.test/alternate.ts' })).toBe(false)
  } finally { timer.mockRestore() }
})

it('cancels cache restoration without publishing partial titles or changing the previous categories', async () => {
  let clock = 0
  const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock += 20)
  try {
    const original = [{ id: 'old', name: 'Original' }], index = new ProviderIndex(source, original), controller = new AbortController()
    const pending = index.restore(saved(4000), controller.signal); controller.abort()
    await expect(pending).rejects.toThrow('canceled')
    expect(index.items).toHaveLength(0); expect(index.categories.live).toBe(original); expect(index.cachedAt).toBeUndefined()
    await index.restore(saved(5)); expect(index.items).toHaveLength(5)
  } finally { timer.mockRestore() }
})

it('rejects an over-budget snapshot transactionally and releases the index for a later restore', async () => {
  const index = new ProviderIndex(source, [], undefined, { records: 3, characters: 5000 })
  await expect(index.restore(saved(4))).rejects.toThrow('memory budget')
  expect(index.items).toEqual([]); expect(index.progress.complete).toBe(false)
  await index.restore(saved(3)); expect(index.progress.titles).toBe(3)
})

it('yields while indexing a downloaded category without exposing partial membership or titles', async () => {
  let clock = 0
  const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock += 20)
  try {
    const titles = saved(20000).entries[0].channels
    const index = new ProviderIndex(source, categories.slice(0, 1), { categories: async () => [], category: async () => ({ channels: titles, skipped: 0 }) })
    const before = index.items, pending = index.start(() => {})
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(index.items).toBe(before); expect(index.items).toHaveLength(0)
    expect(index.has(titles[0])).toBe(false); expect(index.cached('live', categories[0])).toBeUndefined()
    await pending
    expect(index.items).toHaveLength(20000); expect(before).toHaveLength(0)
    expect(index.has(titles[0])).toBe(true); expect(index.progress.complete).toBe(true)
  } finally { timer.mockRestore() }
})

it('can resume during canceled staging cleanup without losing the new run’s title membership', async () => {
  let clock = 0
  const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock += 20)
  try {
    const titles = saved(6000).entries[0].channels, replacement = titles.slice(0, 3000).map(item => ({ ...item, name: `New ${item.name}` }))
    const loader = { categories: async () => [], category: vi.fn().mockResolvedValueOnce({ channels: titles, skipped: 0 }).mockResolvedValue({ channels: replacement, skipped: 0 }) }
    const index = new ProviderIndex(source, categories.slice(0, 1), loader), first = index.start(() => {})
    await new Promise(resolve => setTimeout(resolve, 0)); index.pause()
    const resumed = index.start(() => {}); await Promise.all([first, resumed])
    expect(index.items).toEqual(replacement); expect(index.items.every(item => index.has(item))).toBe(true)
    expect(index.has(titles[5000])).toBe(false); expect(index.progress).toMatchObject({ complete: true, titles: 3000, loaded: 1, running: false })
    expect(index.cached('live', categories[0])?.channels).toBe(replacement)
  } finally { timer.mockRestore() }
})

it('rolls back staged membership after a character-budget failure and can retry smaller results', async () => {
  const titles = saved(2000).entries[0].channels
  const loader = { categories: async () => [], category: vi.fn().mockResolvedValueOnce({ channels: titles, skipped: 0 }).mockResolvedValue({ channels: titles.slice(0, 2), skipped: 0 }) }
  const index = new ProviderIndex(source, categories.slice(0, 1), loader, { records: 2000, characters: 1000 })
  await index.start(() => {})
  expect(index.progress.message).toContain('memory budget'); expect(index.items).toHaveLength(0); expect(index.has(titles[0])).toBe(false)
  await index.start(() => {})
  expect(index.progress).toMatchObject({ complete: true, titles: 2 }); expect(index.has(titles[0])).toBe(true)
})

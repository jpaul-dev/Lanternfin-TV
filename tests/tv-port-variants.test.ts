import { afterEach, expect, it, vi } from 'vitest'
import { groupVariants, indexVariants, preferredVariant } from '../tv-app/variants'
import type { Channel } from '../tv-app/catalog'

afterEach(() => vi.restoreAllMocks())
const channel = (name: string, kind: Channel['mediaKind'] = 'movie'): Channel => ({ name, mediaKind: kind, url: `https://example.com/${encodeURIComponent(name)}`, group: 'Movies' })
it('groups only distinct tagged language versions with matching kinds, editions and years', async () => {
  const english = channel('EN - Arrival (2016)'), french = channel('FR - Arrival (2016)'), high = channel('4K-FR - Arrival (2016)')
  const separate = [channel('Arrival (2016)'), channel('EN - Arrival (1996)'), channel('FR - Arrival (2016) Extended'), channel('FR - Arrival (2016)', 'series'), channel('EN - News', 'live'), channel('FR - News', 'live'), channel('EN - Episode', 'episode'), channel('FR - Episode', 'episode'), channel('EN - Another'), channel('EN - Another')]
  const result = await groupVariants([english, french, high, ...separate], 'fr', new AbortController().signal)
  expect(result.channels).toEqual([french, ...separate]); expect(result.groups.get(english)?.members).toEqual([english, french, high])
  expect(preferredVariant([english, french, high], 'fr-CA')).toBe(french)
  expect(preferredVariant([channel('PT - Title'), channel('BR - Title')], 'pt-BR').name).toBe('BR - Title')
})
it('keeps excessive variant buckets separate rather than rendering an unbounded picker', async () => {
  const items = Array.from({ length: 101 }, (_, i) => channel(`${i % 2 ? 'EN' : 'FR'} - Same title`))
  const result = await groupVariants(items, 'en', new AbortController().signal); expect(result.channels).toHaveLength(101)
})
it('handles the exact version limit, overflow and later members without reviving an overfull group', async () => {
  const signal = new AbortController().signal, hundred = Array.from({ length: 100 }, (_, i) => channel(`${i % 2 ? 'EN' : 'FR'} - Title`))
  const accepted = await groupVariants(hundred, 'en', signal)
  expect(accepted.channels).toEqual([hundred[1]]); expect(accepted.groups.get(hundred[0])?.members).toHaveLength(100)
  const overflow = [...hundred, ...Array.from({ length: 10000 }, () => channel('EN - Title'))]
  const separate = await groupVariants(overflow, 'en', signal)
  expect(separate.channels).toBe(overflow); expect(separate.groups.get(hundred[0])).toBeUndefined(); expect(separate.groups.get(overflow[10000])).toBeUndefined()
})
it('borrows an ungrouped catalog without changing it and recomputes changed title metadata', async () => {
  const items = [channel('EN - First'), channel('FR - Second'), channel('EN - First')], signal = new AbortController().signal
  expect((await groupVariants(items, 'fr', signal)).channels).toBe(items)
  items[1].name = 'FR - First'
  const grouped = await groupVariants(items, 'fr', signal)
  expect(grouped.channels).toEqual([items[1]]); expect(grouped.groups.get(items[0])?.members).toEqual(items)
  expect(items).toHaveLength(3)
})
it('indexes only eligible category members and keeps unrelated provider versions separate', async () => {
  const english = channel('EN - Title'), french = channel('FR - Title'), other = { ...channel('4K-FR - Title'), group: 'Elsewhere' }
  const result = await indexVariants([english, other, french], 'fr', new AbortController().signal, item => item.group === 'Movies')
  expect(result.count).toBe(1); expect(result.groups.get(english)).toEqual({ selected: french, members: [english, french] }); expect(result.groups.get(other)).toBeUndefined()
  const request = new AbortController(); let time = 0; vi.spyOn(performance, 'now').mockImplementation(() => time += 20)
  const pending = indexVariants(Array.from({ length: 5000 }, () => other), 'fr', request.signal, () => false); request.abort()
  await expect(pending).rejects.toThrow('cancelled')
})
it('does not publish a small ungrouped catalog canceled between indexing and return', async () => {
  const request = new AbortController(), pending = groupVariants([channel('EN - Film')], 'en', request.signal)
  request.abort()
  await expect(pending).rejects.toThrow('cancelled')
})
it('yields and cancels a large grouping operation before it can replace newer results', async () => {
  const controller = new AbortController(); let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now += 20)
  setTimeout(() => controller.abort(), 0)
  await expect(groupVariants(Array.from({ length: 5000 }, (_, i) => channel(`EN - Movie ${i}`)), 'en', controller.signal)).rejects.toThrow('cancelled')
})

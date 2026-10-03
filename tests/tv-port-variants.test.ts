import { afterEach, expect, it, vi } from 'vitest'
import { groupVariants, preferredVariant } from '../tv-app/variants'
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
it('yields and cancels a large grouping operation before it can replace newer results', async () => {
  const controller = new AbortController(); let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now += 20)
  setTimeout(() => controller.abort(), 0)
  await expect(groupVariants(Array.from({ length: 5000 }, (_, i) => channel(`EN - Movie ${i}`)), 'en', controller.signal)).rejects.toThrow('cancelled')
})

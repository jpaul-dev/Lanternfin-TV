import { afterEach, expect, it, vi } from 'vitest'
import { programmes, nowNext, TVGuide, boundProgrammes } from '../tv-app/guide'
const now = Date.now(), seconds = (n: number) => Math.floor((now + n * 60000) / 1000)
const row = { start_timestamp: seconds(-10), stop_timestamp: seconds(20), title: btoa('News'), description: btoa('<b>Inert description</b>'), has_archive: '1' }
afterEach(() => vi.unstubAllGlobals())
it('normalizes bounded programme data and excludes invalid dates and duplicate rows', () => {
  const list = programmes([row, row, { ...row, start_timestamp: 'bad' }, { ...row, stop_timestamp: 1 }, { ...row, start_timestamp: seconds(30), stop_timestamp: seconds(60), title: 'Next show' }], now)
  expect(list).toHaveLength(2); expect(nowNext(list, now).current).toMatchObject({ title: 'News', description: '<b>Inert description</b>', archive: true })
  expect(nowNext(list, now).next?.title).toBe('Next show')
  expect(programmes([{ ...row, title: 'Test', description: 'x'.repeat(20000) }])[0].description.length).toBeLessThanOrEqual(4000)
})
it('uses provider spelling fallbacks, caches results, and supports refresh', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(new URL(url).searchParams.get('action') === 'get_simple_date_table' ? { epg_listings: [row] } : {})))
  vi.stubGlobal('fetch', fetcher)
  const guide = new TVGuide({ kind: 'xtream', url: 'https://example.com', username: 'u', password: 'p' }), channel = { name: 'News', url: 'https://example.com/live', group: '', mediaKind: 'live' as const, providerId: '1' }, signal = new AbortController().signal
  expect((await guide.load(channel, signal))[0].title).toBe('News'); expect(fetcher).toHaveBeenCalledTimes(2)
  await guide.load(channel, signal); expect(fetcher).toHaveBeenCalledTimes(2)
  await guide.load(channel, signal, true); expect(fetcher).toHaveBeenCalledTimes(4)
  const controller = new AbortController(); controller.abort()
  await expect(guide.load(channel, controller.signal, true)).rejects.toThrow('cancelled')
})
it('keeps the current programme in large guides and isolates a requested day', () => {
  const items = Array.from({ length: 1500 }, (_, index) => ({ start: now + (index - 1000) * 60000, stop: now + (index - 999) * 60000 }))
  const bounded = boundProgrammes(items, now); expect(bounded).toHaveLength(512)
  expect(bounded.some(item => item.start === now)).toBe(true)
  const day = { fromMs: now + 86400000, toMs: now + 2 * 86400000 }
  const rows = [row, { ...row, start_timestamp: Math.floor((day.fromMs + 60000) / 1000), stop_timestamp: Math.floor((day.fromMs + 120000) / 1000) }]
  expect(programmes(rows, now, day)).toHaveLength(1)
})

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { TVGuide, programmes } from '../tv-app/guide'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'

const hour = 3600000, day = 24 * hour, now = Date.UTC(2026, 9, 3, 12)
const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
const entry = (start: number, name: string) => `<programme channel="news" start="${stamp(start)}" stop="${stamp(start + hour)}"><title>${name}</title></programme>`
const feed = (entries: string) => `<tv><channel id="news"><display-name>News</display-name></channel>${entries}</tv>`
const channel = { name: 'News', group: '', url: 'https://example.test/live.m3u8', tvgId: 'news', mediaKind: 'live' as const }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the entire oldest selected calendar day from provider API results', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const fromMs = now - 7 * day - 12 * hour, toMs = fromMs + day, start = fromMs + hour
  const rows = [{ title: 'Oldest morning', start_timestamp: start / 1000, stop_timestamp: (start + hour) / 1000 }]
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ epg_listings: rows }))))
  const guide = new TVGuide({ kind: 'xtream', url: 'https://example.test', username: 'test', password: 'test' })
  expect(await guide.load({ ...channel, providerId: '1' }, new AbortController().signal, false, { fromMs, toMs })).toEqual([expect.objectContaining({ title: 'Oldest morning', start })])
  expect(programmes(rows, now)).toEqual([])
  expect(programmes(rows, now, { fromMs: now - 30 * day, toMs: now - 29 * day })).toEqual([])
  expect(() => programmes(rows, now, { fromMs: NaN, toMs: now })).toThrow('time window')
  guide.clear()
})

it.each([
  { label: 'two days ahead', offset: 0, channelShift: 0, from: now + 2 * day, start: now + 2 * day + hour },
  { label: 'future with earliest correction', offset: -720, channelShift: -24, from: now + 2 * day, start: now + 2 * day + hour },
  { label: 'oldest day with latest correction', offset: 840, channelShift: 24, from: now - 7 * day, start: now - 7 * day + hour },
])('extracts the selected TV day across $label without clipping corrected raw timestamps', async ({ offset, channelShift, from, start }) => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  class TestWorker {
    onmessage?: (event: { data: unknown }) => void
    terminate() {}
    postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
  }
  vi.stubGlobal('Worker', TestWorker)
  const shift = (offset + channelShift * 60) * 60000, rawStart = start - shift
  const fetcher = vi.fn(async () => new Response(feed(entry(rawStart, 'Selected programme') + entry(rawStart + 2 * day, 'Outside selected day'))))
  vi.stubGlobal('fetch', fetcher)
  const guide = new TVGuide({ kind: 'playlist', url: 'https://example.test/list.m3u' }, 'https://example.test/guide.xml', offset)
  const rows = await guide.load({ ...channel, tvgShift: channelShift }, new AbortController().signal, false, { fromMs: from, toMs: from + day })
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ title: 'Selected programme', start, stop: start + hour })
  if (shift) expect(rows[0].guideShiftMinutes).toBe(shift / 60000)
  expect(fetcher).toHaveBeenCalledTimes(1); guide.clear()
})

async function retain(xml: string, mode: 'text' | 'stream' | 'gzip') {
  const feedId = `tv-window-${mode}`
  if (mode === 'text') handleWorkerRequest({ type: 'parse', id: 1, xml, mode: 'now-next', nowMs: now, feedId })
  else {
    handleWorkerRequest({ type: 'begin', id: 1, feedId, mode: 'now-next', nowMs: now, gzip: mode === 'gzip' })
    const bytes = mode === 'gzip' ? gzipSync(xml) : new TextEncoder().encode(xml)
    for (let offset = 0; offset < bytes.length; offset += 127) {
      const part = new Uint8Array(bytes.slice(offset, offset + 127))
      await handleWorkerRequest({ type: 'chunk', id: 1, feedId, bytes: part.buffer })
    }
    const reply = await handleWorkerRequest({ type: 'end', id: 1, feedId }); expect(reply).not.toHaveProperty('error')
  }
  return (window?: { fromMs: number; toMs: number }) => handleWorkerRequest({ type: 'programmesFor', id: 2, feedId, tvgId: 'news', window })
}

it.each(['text', 'stream', 'gzip'] as const)('honors explicit channel windows and keeps implicit scans bounded in %s mode', async mode => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const query = await retain(feed(entry(now, 'Current') + entry(now + 60 * hour, 'Future') + entry(now - 9 * day, 'Shifted archive') + entry(now + 30 * day, 'Too far ahead') + entry(now - 30 * day, 'Too old')), mode)
  expect((await query()).programmes).toEqual([expect.objectContaining({ title: 'Current' })])
  expect((await query({ fromMs: now + 2 * day, toMs: now + 3 * day })).programmes).toEqual([expect.objectContaining({ title: 'Future' })])
  expect((await query({ fromMs: now - 9 * day, toMs: now - 8 * day })).programmes).toEqual([expect.objectContaining({ title: 'Shifted archive' })])
  const bounded = await query({ fromMs: now - 60 * day, toMs: now + 60 * day })
  expect(bounded.programmes?.map(item => 'title' in item ? item.title : '')).toEqual(['Shifted archive', 'Current', 'Future'])
  expect((await query({ fromMs: now + 30 * day, toMs: now + 31 * day })).programmes).toEqual([])
  for (const window of [{ fromMs: NaN, toMs: now }, { fromMs: now, toMs: Infinity }, { fromMs: now, toMs: now }, { fromMs: now + day, toMs: now }]) expect(await query(window)).toHaveProperty('error')
})

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { XMLTVGuide } from '../tv-app/xmltv'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { parseCatalog } from '../tv-app/catalog'
afterEach(() => vi.unstubAllGlobals())
class TestWorker {
  onmessage?: (event: { data: unknown }) => void
  terminate() {}
  postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
}
const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
const now = Date.now(), xml = `<tv><channel id="news"><display-name>News</display-name></channel><programme channel="news" start="${stamp(now - 600000)}" stop="${stamp(now + 600000)}"><title>News &amp; weather</title><desc>Current conditions</desc></programme></tv>`
it('preserves playlist guide addresses and bounded channel IDs', () => {
  const catalog = parseCatalog('#EXTM3U x-tvg-url="guide.xml"\n#EXTINF:-1 tvg-id="news",News\nhttps://example.com/live.m3u8', 'https://example.com/list.m3u')
  expect(catalog.epgUrl).toBe('https://example.com/guide.xml'); expect(catalog.channels[0].tvgId).toBe('news')
})
it.each([false, true])('loads an XMLTV guide through the Android worker, gzip=%s', async gzip => {
  vi.stubGlobal('Worker', TestWorker)
  const bytes = gzip ? gzipSync(xml) : new TextEncoder().encode(xml)
  let offset = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) controller.close(); else { controller.enqueue(new Uint8Array(bytes.slice(offset, offset + 1))); offset++ } } }))))
  const guide = new XMLTVGuide('https://example.com/guide.xml'), signal = new AbortController().signal
  const rows = await guide.load('news', 'News', signal)
  expect(rows[0]).toMatchObject({ title: 'News & weather', desc: 'Current conditions' })
  expect((await guide.load(undefined, 'News', signal))[0].title).toBe('News & weather')
  expect(fetch).toHaveBeenCalledTimes(1); guide.close()
})
it('cancels before accessing a guide and redacts failed network addresses', async () => {
  vi.stubGlobal('Worker', TestWorker); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch https://provider.example?password=private')))
  const guide = new XMLTVGuide('https://example.com/guide.xml'), controller = new AbortController(); controller.abort()
  await expect(guide.load('news', 'News', controller.signal)).rejects.toThrow('cancelled'); expect(fetch).not.toHaveBeenCalled()
  await expect(guide.load('news', 'News', new AbortController().signal)).rejects.toThrow('Cannot reach the XMLTV guide'); guide.close()
})
it('enforces the packaged-TV channel budget in the shared worker', async () => {
  handleWorkerRequest({ type: 'begin', id: 1, feedId: 'bounded-tv', mode: 'now-next', gzip: false, nowMs: now, maxChannels: 1 })
  handleWorkerRequest({ type: 'chunk', id: 1, feedId: 'bounded-tv', bytes: new TextEncoder().encode('<tv><channel id="1"><display-name>One</display-name></channel><channel id="2"><display-name>Two</display-name></channel></tv>').buffer })
  const response = await handleWorkerRequest({ type: 'end', id: 1, feedId: 'bounded-tv' })
  expect(response).toHaveProperty('error', expect.stringContaining('channel budget'))
})

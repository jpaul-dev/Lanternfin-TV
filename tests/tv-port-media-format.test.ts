import { afterEach, expect, it, vi } from 'vitest'
import { mediaFormat, needsMediaProbe, resolveMediaFormat } from '../tv-app/media-format'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const media = { url: 'https://provider.example/watch?id=private', playback: { headers: { Authorization: 'media-secret' }, drm: { system: 'org.w3.clearkey', headers: { Authorization: 'license-secret' } } } }
const signal = () => new AbortController().signal
it('probes only ambiguous header-bearing URLs and keeps explicit formats authoritative', () => {
  expect(needsMediaProbe(media)).toBe(true)
  for (const url of ['https://example.test/constructor', 'https://example.test/__proto__', 'https://example.test/play.php?file=movie.mp4']) expect(needsMediaProbe({ ...media, url })).toBe(true)
  for (const url of ['https://example.test/a.mp4#part', 'https://example.test/a.m3u8', 'https://example.test/a.ts', 'https://example.test/a.webm']) expect(needsMediaProbe({ ...media, url })).toBe(false)
  expect(needsMediaProbe({ url: media.url })).toBe(false)
  expect(needsMediaProbe({ ...media, playback: { headers: { Cookie: 'private' } } })).toBe(false)
  expect(needsMediaProbe({ ...media, playback: { ...media.playback, problem: 'Invalid' } })).toBe(false)
  expect(mediaFormat({ ...media, playback: { manifestType: 'hls' } })).toBe('hls')
  expect(mediaFormat({ ...media, playback: { manifestType: 'constructor' } })).toBe('other')
})
it.each([
  ['video/mp4; codecs="avc1.42E01E"', 'mp4'], ['audio/mp4', 'mp4'], ['video/quicktime', 'mp4'],
  ['application/vnd.apple.mpegurl', 'hls'], ['application/dash+xml', 'dash'], ['video/mp2t', 'mpegts'], ['video/x-flv', 'flv'],
])('uses a declared %s response without consuming its body', async (type, format) => {
  const cancel = vi.fn(), fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': type } }))
  vi.stubGlobal('fetch', fetch)
  const result = await resolveMediaFormat(media, signal())
  expect(result.playback?.manifestType).toBe(format); expect(result.playback?.headers).toBe(media.playback.headers); expect(result.playback?.drm).toBe(media.playback.drm)
  expect(media.playback).not.toHaveProperty('manifestType'); expect(cancel).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith(media.url, expect.objectContaining({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Authorization: 'media-secret', Range: 'bytes=0-4095' } }))
})
it.each([
  ['hls', '\uFEFF#EXTM3U\n#EXT-X-TARGETDURATION:6\n'], ['dash', '<?xml version="1.0"?>\n<!-- guide -->\n<MPD type="static">'],
  ['mp4', '\x00\x00\x00\x18ftypisom'], ['flv', 'FLV\x01\x01\x00\x00\x00\x09'],
])('sniffs %s while cancelling an ignored Range response after a bounded prefix', async (format, prefix) => {
  const bytes = new Uint8Array(1024 * 1024); bytes.set(new TextEncoder().encode(prefix))
  const cancel = vi.fn(), pulls = vi.fn(controller => controller.enqueue(bytes))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull: pulls, cancel }), { headers: { 'Content-Type': 'application/octet-stream' } })))
  expect((await resolveMediaFormat(media, signal())).playback?.manifestType).toBe(format)
  expect(cancel).toHaveBeenCalledOnce(); expect(pulls.mock.calls.length).toBeLessThanOrEqual(2)
})
it.each([['mpegts', 0, 188], ['m2ts', 4, 192]] as const)('recognizes %s packet framing', async (format, start, stride) => {
  const bytes = new Uint8Array(4096); for (let i = start; i < bytes.length; i += stride) bytes[i] = 0x47
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  expect((await resolveMediaFormat(media, signal())).playback?.manifestType).toBe(format)
})
it('rejects unknown formats, HTTP errors and conflicting ranges without leaking private values', async () => {
  const fetch = vi.fn(async () => new Response('<html>private provider login</html>'))
  vi.stubGlobal('fetch', fetch)
  await expect(resolveMediaFormat(media, signal())).rejects.toThrow('format could not be identified')
  fetch.mockResolvedValueOnce(new Response('private', { status: 403 }))
  await expect(resolveMediaFormat(media, signal())).rejects.not.toThrow('secret')
  await expect(resolveMediaFormat({ ...media, playback: { headers: { Range: 'bytes=8-16' } } }, signal())).rejects.toThrow('format')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('times out even if fetch ignores abort, and cancels a late response', async () => {
  vi.useFakeTimers(); let respond: (value: Response) => void = () => {}
  const fetch = vi.fn((_url, _init) => new Promise<Response>(resolve => { respond = resolve }))
  vi.stubGlobal('fetch', fetch)
  const result = resolveMediaFormat(media, signal()); const rejected = expect(result).rejects.toThrow('format could not be identified')
  await vi.advanceTimersByTimeAsync(10000); await rejected
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  const cancel = vi.fn(); respond(new Response(new ReadableStream({ cancel }))); await vi.advanceTimersByTimeAsync(0)
  expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})
it('aborts a stalled prefix read and does not fetch after pre-cancellation', async () => {
  vi.useFakeTimers(); const cancel = vi.fn(), controller = new AbortController()
  const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })))
  vi.stubGlobal('fetch', fetch)
  const result = resolveMediaFormat(media, controller.signal); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0); controller.abort(); await rejected
  expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  await expect(resolveMediaFormat(media, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).toHaveBeenCalledOnce()
})

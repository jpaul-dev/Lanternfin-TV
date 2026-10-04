// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { loadSubtitles, parseSubtitles, SUBTITLE_BYTES } from '../tv-app/external-subtitles'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello <i>world</i> &amp; friends\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond line'

it('parses SRT, overlaps, exact boundaries and backwards seeks without executing markup', async () => {
  const cues = await parseSubtitles('\uFEFF' + srt.replace(/\n/g, '\r\n'))
  expect(cues.count).toBe(2)
  expect(cues.at(1)).toBe('Hello world & friends')
  expect(cues.at(2)).toBe('Hello world & friends\nSecond line')
  expect(cues.at(3)).toBe('Second line'); expect(cues.at(4)).toBe('')
  expect(cues.at(1)).toBe('Hello world & friends'); expect(cues.at(-1)).toBe('')
  const text = await parseSubtitles('1\n00:01.000 --> 00:02.000\n<img src=x onerror=alert(1)> &lt;b&gt;literal&lt;/b&gt;')
  expect(text.at(1)).toBe('<img src=x onerror=alert(1)> <b>literal</b>')
})

it('accepts WebVTT identifiers, cue settings, text tags and ignorable metadata as text-only captions', async () => {
  const cues = await parseSubtitles('WEBVTT\nCaption sample\n\nNOTE explanation\nnot a cue\n\nSTYLE\n::cue { color: red; }\n\nREGION\nid:demo\n\nopening\n00:01.000 --> 00:03.000 align:start position:20%\n<v Speaker><c.green>Hello</c></v>\nSecond line')
  expect(cues.at(2)).toBe('Hello\nSecond line')
  await expect(parseSubtitles('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n00:01.000 --> 00:03.000\nHello')).rejects.toThrow('timestamp maps')
})

it('rejects invalid timing, empty/oversized cues, bytes and encoding', async () => {
  for (const text of ['not subtitles', 'WEBVTT', '00:99.000 --> 01:02.000\nbad', '00:02.000 --> 00:01.000\nbad', '00:01.000 --> 999:00:00.000\nbad', '00:01.000 --> 00:02.000\n' + 'x'.repeat(4097)]) {
    await expect(parseSubtitles(text)).rejects.toThrow()
  }
  await expect(parseSubtitles('é'.repeat(SUBTITLE_BYTES / 2 + 1))).rejects.toThrow('2 MB')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xc0, 0x80]))))
  await expect(loadSubtitles('https://captions.example/file.vtt', new AbortController().signal)).rejects.toThrow('UTF-8')
})

it('bounds overlap output and cooperatively cancels a large parsing job', async () => {
  vi.useFakeTimers()
  const text = Array.from({ length: 2000 }, (_, i) => `${i}\n00:00.000 --> 00:10.000\nCaption ${i}`).join('\n\n')
  const controller = new AbortController(), pending = parseSubtitles(text, controller.signal)
  const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await vi.runAllTimersAsync(); await result
  const completed = parseSubtitles(text); await vi.runAllTimersAsync()
  expect((await completed).at(5).split('\n')).toHaveLength(8)
})

it('fetches subtitle URLs without credentials, referrer, provider headers or cache', async () => {
  const fetch = vi.fn(async () => new Response(srt)); vi.stubGlobal('fetch', fetch)
  const cues = await loadSubtitles('https://captions.example/file.srt?token=private', new AbortController().signal)
  expect(cues.at(1)).toBe('Hello world & friends')
  expect(fetch).toHaveBeenCalledWith('https://captions.example/file.srt?token=private', {
    credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: expect.any(AbortSignal),
  })
  for (const url of ['file:///tmp/captions.srt', 'https://user:password@captions.example/file.vtt']) await expect(loadSubtitles(url, new AbortController().signal)).rejects.toThrow('HTTP or HTTPS')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('enforces streamed bytes even without Content-Length and cancels the response', async () => {
  const cancel = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(SUBTITLE_BYTES)); controller.enqueue(new Uint8Array(1)) }, cancel }))))
  await expect(loadSubtitles('https://captions.example/file.vtt', new AbortController().signal)).rejects.toThrow('2 MB')
  expect(cancel).toHaveBeenCalledOnce()
})

it('redacts network errors and distinguishes cancellation from timeout', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('https://private.example/?token=secret') }))
  await expect(loadSubtitles('https://captions.example/file.vtt', new AbortController().signal)).rejects.toThrow('Cannot load this subtitle URL')
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('secret'))))))
  const controller = new AbortController(), pending = loadSubtitles('https://captions.example/file.vtt', controller.signal)
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled
  const timed = expect(loadSubtitles('https://captions.example/file.vtt', new AbortController().signal)).rejects.toThrow('took too long')
  await vi.advanceTimersByTimeAsync(30000); await timed
})

it('reads local UTF-8 files with FileReader and rejects oversize before reading', async () => {
  const cues = await loadSubtitles(new File([srt], 'private-name.srt'), new AbortController().signal)
  expect(cues.count).toBe(2)
  await expect(loadSubtitles(new File([new Uint8Array(SUBTITLE_BYTES + 1)], 'big.srt'), new AbortController().signal)).rejects.toThrow('2 MB')
})

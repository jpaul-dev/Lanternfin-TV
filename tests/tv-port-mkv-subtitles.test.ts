import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkvFixture, element, integer, join, text, vint } from './helpers/mkv-fixtures'
import { parseMkvMetadata, decodeMkvCue, ebmlHeader, ebmlVint, validateMkvHeader } from '../tv-app/mkv-text'
import { openMkvSubtitles, mkvSubtitleProblem, parseMkvWorker } from '../tv-app/mkv-subtitles'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
const parser = async (input: Parameters<typeof parseMkvMetadata>[0]) => parseMkvMetadata(input)
const signal = () => new AbortController().signal
const media = { url: 'https://example.test/movie.mkv' }
function serve(file: Pick<ReturnType<typeof mkvFixture>, 'total' | 'read'>, options: { hidden?: boolean; status?: number; tag?: () => string; shift?: number } = {}) {
  const requests: { start: number; end: number; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range')!)!, start = +range[1], end = Math.min(+range[2], file.total - 1)
    requests.push({ start, end, init })
    return new Response(file.read(start, end - start + 1), { status: options.status || 206, headers: { ...(options.hidden ? {} : { 'content-range': `bytes ${start + (options.shift || 0)}-${end}/${file.total}` }), ...(options.tag ? { etag: options.tag() } : {}) } })
  }))
  return requests
}
it('reads a real FFmpeg muxed MKV with video and two subtitle tracks', async () => {
  const bytes = readFileSync('tests/fixtures/tv-mkv-text.mkv'); serve({ total: bytes.length, read: (start, length) => new Uint8Array(bytes.subarray(start, start + length)) })
  const session = await openMkvSubtitles(media, signal(), parser)
  expect(session.tracks.map(track => [track.id, track.language])).toEqual([[2, 'eng'], [3, 'fra']])
  expect((await session.read(2, 2, signal())).timeline.at(2)).toBe('Embedded MKV captions\nEnglish track: opening')
  expect((await session.read(2, 40, signal())).timeline.at(40)).toContain('approaching the end')
  expect((await session.read(2, 58, signal())).timeline.at(58)).toBe('')
  expect((await session.read(3, 60, signal())).timeline.at(60)).toBe('Sous-titres MKV integres\nPiste francaise')
})

it('seeks to both indexed text tracks and includes a long cue that started before the read window', async () => {
  const file = mkvFixture({ gap: 100000 }), requests = serve(file), session = await openMkvSubtitles(media, signal(), parser)
  expect(session.tracks.map(track => [track.id, track.language])).toEqual([[1, 'eng'], [2, 'fra']])
  const english = await session.read(1, 55, signal()), french = await session.read(2, 55, signal())
  expect(english.timeline.at(55)).toBe('Long English caption'); expect(french.timeline.at(55)).toBe('Longue légende française')
  const count = requests.length; await session.read(1, 60, signal()); expect(requests).toHaveLength(count)
  const later = await session.read(1, 106, signal()); expect(later.timeline.at(106)).toBe('Later caption'); expect(later.timeline.at(110)).toBe('')
  expect(requests.reduce((sum, r) => sum + r.end - r.start + 1, 0)).toBeLessThan(70000)
})
it('follows SeekHead offsets past a four-gigabyte media gap without downloading it', async () => {
  const file = mkvFixture({ gap: 2 ** 32 + 10 }), requests = serve(file), session = await openMkvSubtitles(media, signal(), parser)
  expect((await session.read(1, 1, signal())).timeline.at(1)).toBe('Long English caption')
  expect(requests.some(r => r.start > 2 ** 32)).toBe(true); expect(requests.every(r => r.end - r.start + 1 <= 65536)).toBe(true)
})
it('supports block-number indexes, missing cue duration and sized segments with hidden Content-Range', async () => {
  const file = mkvFixture({ relative: false, cueDuration: false, gap: 100000 }); serve(file, { hidden: true })
  const session = await openMkvSubtitles(media, signal(), parser)
  expect((await session.read(1, 55, signal())).timeline.at(55)).toBe('Long English caption')
})
it('accepts an unknown-sized Segment only when the file size is known', async () => {
  const file = mkvFixture({ unknownSegment: true }); serve(file)
  expect((await openMkvSubtitles(media, signal(), parser)).tracks).toHaveLength(2)
  serve(file, { hidden: true }); await expect(openMkvSubtitles(media, signal(), parser)).rejects.toThrow('index')
})
it('reads indexed blocks in unknown-sized clusters and rejects index/block disagreement', async () => {
  const file = mkvFixture(), cluster = file.clusters[0], header = ebmlHeader(cluster.bytes)
  expect(header.data).toBe(5); cluster.bytes[4] = 255; serve(file)
  const session = await openMkvSubtitles(media, signal(), parser)
  expect((await session.read(1, 1, signal())).timeline.at(1)).toBe('Long English caption')
  const track = parseMkvMetadata(file.metadata).tracks[0]
  expect(() => decodeMkvCue(cluster.block, track, { ...track.samples[0], start: 9 }, 0, .001)).toThrow()
  expect(() => decodeMkvCue(cluster.block, { ...track, id: 2 }, track.samples[0], 0, .001)).toThrow()
})
it('decodes plain ASS/SSA/WebVTT text without interpreting drawing commands or markup', async () => {
  for (const codec of ['S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT']) {
    const value = codec.endsWith('WEBVTT') ? '<b>Caption</b> &amp; <img src=x>' : '0,0,Default,,0,0,0,,{\\i1}Caption{\\i0}\\N{\\p1}m 0 0 l 9 9{\\p0}second'
    const file = mkvFixture({ codec, samples: [{ track: 1, start: 0, end: 5, text: value }] }); serve(file)
    const session = await openMkvSubtitles(media, signal(), parser), window = await session.read(1, 0, signal())
    expect(window.timeline.at(1)).toBe(codec.endsWith('WEBVTT') ? 'Caption & <img src=x>' : 'Caption\nsecond')
  }
})
it('accepts default-duration SimpleBlock and rejects missing or inconsistent duration and lacing', async () => {
  const file = mkvFixture({ simple: true, defaultDuration: 5, samples: [{ track: 1, start: 0, end: 5, text: 'Simple' }] }); serve(file)
  expect((await (await openMkvSubtitles(media, signal(), parser)).read(1, 0, signal())).timeline.at(1)).toBe('Simple')
  const track = parseMkvMetadata(file.metadata).tracks[0], cue = track.samples[0], block = file.clusters[0].block.slice()
  expect(() => decodeMkvCue(block, { ...track, defaultDuration: 6 }, cue, 0, .001)).toThrow()
  expect(() => decodeMkvCue(block, { ...track, defaultDuration: undefined }, { ...cue, end: undefined }, 0, .001)).toThrow()
  block[ebmlHeader(block).data + 3] = 2; expect(() => decodeMkvCue(block, track, cue, 0, .001)).toThrow()
})
it('preserves required headers, refuses protected media, forbidden/reserved headers and unsupported ranges', async () => {
  const file = mkvFixture({ gap: 100000 }), requests = serve(file)
  await openMkvSubtitles({ ...media, playback: { headers: { Authorization: 'media-only' } } }, signal(), parser)
  expect(requests[0].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', headers: { Authorization: 'media-only' } })
  for (const headers of [{ Cookie: 'secret' }, { Range: 'bytes=0-99' }, { 'If-Range': 'tag' }]) expect(mkvSubtitleProblem({ ...media, playback: { headers } })).toContain('headers')
  expect(mkvSubtitleProblem({ ...media, playback: { drm: { system: 'com.widevine.alpha' } } })).toContain('player')
  for (const options of [{ status: 200 }, { shift: 1 }]) { serve(file, options); await expect(openMkvSubtitles(media, signal(), parser)).rejects.toThrow() }
})
it('detects a changed file without publishing caption data', async () => {
  let tag = 'one'; const file = mkvFixture({ gap: 100000 }); serve(file, { tag: () => tag })
  const session = await openMkvSubtitles(media, signal(), parser); tag = 'two'
  await expect(session.read(1, 0, signal())).rejects.toThrow('changed')
  tag = 'one'; expect((await session.read(1, 0, signal())).timeline.at(1)).toBe('Long English caption')
})
it('bounds unsafe EBML integers, malformed indexes, sample text and metadata', () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([0]), new Uint8Array([1]), new Uint8Array([1, 254, 255, 255, 255, 255, 255, 255])]) expect(() => ebmlVint(bytes)).toThrow()
  expect(ebmlVint(new Uint8Array([255])).unknown).toBe(true)
  const file = mkvFixture()
  expect(() => parseMkvMetadata({ ...file.metadata, info: join(integer(0x2ad7b1, 1), integer(0x2ad7b1, 2)) })).toThrow()
  expect(() => parseMkvMetadata({ ...file.metadata, cues: new Uint8Array(8 * 1024 * 1024 + 1) })).toThrow()
  const track = parseMkvMetadata(file.metadata).tracks[0]
  const payload = join(vint(1), new Uint8Array([0, 0, 0]), text('x'.repeat(4097)))
  expect(() => decodeMkvCue(element(0xa0, element(0xa1, payload), integer(0x9b, 70000)), track, track.samples[0], 0, .001)).toThrow()
  const evil = element(0xbb, integer(0xb3, 0), element(0xb7, integer(0xf7, 1), integer(0xf1, Number.MAX_SAFE_INTEGER)))
  expect(() => parseMkvMetadata({ ...file.metadata, cues: evil })).toThrow()
})
it('accepts NUL-terminated EBML strings without weakening binary subtitle validation', () => {
  const file = mkvFixture()
  const entry = element(0xae, integer(0xd7, 1), integer(0x83, 17), element(0x86, text('S_TEXT/UTF8\0\0')), element(0x22b59c, text('eng\0')), element(0x536e, join(text('Captions\0'), new Uint8Array([255]))))
  const track = parseMkvMetadata({ ...file.metadata, tracks: entry }).tracks[0]
  expect(track).toMatchObject({ codec: 'S_TEXT/UTF8', language: 'eng', name: 'Captions' })
  expect(() => validateMkvHeader(element(0x4282, text('matroska\0\0')))).not.toThrow()
  const payload = join(vint(1), new Uint8Array([0, 0, 0]), text('Hidden\0caption'))
  expect(() => decodeMkvCue(element(0xa0, element(0xa1, payload), integer(0x9b, 70000)), track, track.samples[0], 0, .001)).toThrow()
})
it('skips image/encrypted/compressed tracks and rejects unexpected file types', async () => {
  const file = mkvFixture({ codec: 'S_HDMV/PGS' }); expect(parseMkvMetadata(file.metadata).tracks).toHaveLength(0)
  const entry = element(0xae, integer(0xd7, 1), integer(0x83, 17), element(0x86, text('S_TEXT/UTF8')), element(0x6d80))
  expect(parseMkvMetadata({ ...file.metadata, tracks: entry }).tracks).toHaveLength(0)
  serve(mkvFixture({ docType: 'not-matroska' })); await expect(openMkvSubtitles(media, signal(), parser)).rejects.toThrow()
})
it('settles cancelled/stalled transports and terminates timed-out metadata workers', async () => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  const controller = new AbortController(), cancelled = expect(openMkvSubtitles(media, controller.signal, parser)).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled
  const stalled = expect(openMkvSubtitles(media, signal(), parser)).rejects.toThrow('too long'); await vi.advanceTimersByTimeAsync(15000); await stalled
  const terminate = vi.fn(); vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} })
  const worker = expect(parseMkvWorker(mkvFixture().metadata, signal())).rejects.toThrow('too long'); await vi.advanceTimersByTimeAsync(10000); await worker
  expect(terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})

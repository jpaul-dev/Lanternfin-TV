import { afterEach, expect, it, vi } from 'vitest'
import { buildMp4, tx3gCluster, box, fullBox, uint16, uint32, uint64, zeros, type BuiltMp4, type TrackFixture } from './helpers/mp4-fixtures'
import { decodeMp4Text, mp4BoxHeader, parseMp4Text } from '../tv-app/mp4-text'
import { mp4SubtitleProblem, openMp4Subtitles, parseMp4Worker } from '../tv-app/mp4-subtitles'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const fixture = (changes: Partial<TrackFixture> = {}) => buildMp4({ tracks: [{ trackId: 1, mediaType: 'text', language: 'eng', sampleClusters: [tx3gCluster(['First', '', 'Third'])], ...changes }], moovPosition: 'after-mdat' })
const moov = (built: BuiltMp4) => built.bytes.slice(built.moovOffset, built.moovOffset + built.moovSize)
function replace(bytes: Uint8Array, name: string, replacement: Uint8Array): Uint8Array {
  const header = mp4BoxHeader(bytes)
  if (header.type === name) return replacement
  if (!['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(header.type)) return bytes
  const children: Uint8Array[] = []
  for (let at = header.header; at < bytes.length;) { const next = mp4BoxHeader(bytes, at); children.push(replace(bytes.slice(at, at + next.size), name, replacement)); at += next.size }
  return box(header.type, ...children)
}
function child(bytes: Uint8Array, type: string): Uint8Array {
  for (let at = mp4BoxHeader(bytes).header; at < bytes.length;) { const h = mp4BoxHeader(bytes, at); if (h.type === type) return bytes.slice(at, at + h.size); at += h.size }
  throw new Error('Missing fixture child')
}
const parser = async (bytes: Uint8Array) => parseMp4Text(bytes)
function serve(built: BuiltMp4, options: { hidden?: boolean; status?: number; shift?: number; tooLarge?: boolean; truncate?: boolean; tag?: () => string } = {}) {
  const requests: { start: number; end: number; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range')!)!, start = +match[1], end = Math.min(+match[2], built.bytes.length - 1)
    requests.push({ start, end, init })
    const headers: Record<string, string> = options.hidden ? {} : { 'content-range': `bytes ${start + (options.shift || 0)}-${end}/${built.bytes.length}` }
    if (options.tag) headers.etag = options.tag()
    return new Response(options.tooLarge ? new Uint8Array(+match[2] - start + 2) : built.bytes.slice(start, options.truncate ? end : end + 1), { status: options.status || 206, headers })
  }))
  return requests
}

it('parses only clear text tables and decodes plain tx3g cues', async () => {
  const built = fixture(), tracks = parseMp4Text(moov(built))
  expect(tracks[0]).toMatchObject({ id: 1, language: 'eng', samples: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }] })
  serve(built); const session = await openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, new AbortController().signal, parser)
  const window = await session.read(1, 0, new AbortController().signal)
  expect(window.timeline.at(0)).toBe('First'); expect(window.timeline.at(1)).toBe(''); expect(window.timeline.at(2.5)).toBe('Third')
})

it('skips unsupported and encrypted sample descriptions', () => {
  expect(parseMp4Text(moov(fixture({ codecFourcc: 'stpp' })))).toEqual([])
  expect(parseMp4Text(moov(fixture({ codecFourcc: 'enct' })))).toEqual([])
  const base = fixture({ mediaType: 'audio' }), bytes = moov(base)
  expect(parseMp4Text(replace(bytes, 'stsz', fullBox('stsz', 0, 0, uint32(1), uint32(0xffffffff))))).toEqual([])
})

it('handles 64-bit chunk offsets and compact 4/8/16-bit sample sizes', () => {
  const base = fixture(), offsets = base.sampleOffsetsPerTrack[0]
  const wide = replace(moov(base), 'stco', fullBox('co64', 0, 0, uint32(3), ...offsets.map(uint64)))
  expect(parseMp4Text(wide)[0].samples.map(s => s.offset)).toEqual(offsets)
  for (const bits of [4, 8, 16]) {
    const data = bits === 4 ? new Uint8Array([0x72, 0x70]) : bits === 8 ? new Uint8Array([7, 2, 7]) : new Uint8Array([0, 7, 0, 2, 0, 7])
    const compact = fullBox('stz2', 0, 0, new Uint8Array([0, 0, 0, bits]), uint32(3), data)
    expect(parseMp4Text(replace(wide, 'stsz', compact))[0].samples.map(s => s.size)).toEqual([7, 2, 7])
  }
})

it('maps sample runs across chunks and rejects inconsistent sample counts', () => {
  const base = fixture(), bytes = replace(replace(moov(base), 'stco', fullBox('stco', 0, 0, uint32(1), uint32(base.sampleOffsetsPerTrack[0][0]))), 'stsc', fullBox('stsc', 0, 0, uint32(1), uint32(1), uint32(3), uint32(1)))
  expect(parseMp4Text(bytes)[0].samples.map(s => s.offset)).toEqual(base.sampleOffsetsPerTrack[0])
  expect(() => parseMp4Text(replace(bytes, 'stsc', fullBox('stsc', 0, 0, uint32(1), uint32(1), uint32(2), uint32(1))))).toThrow()
  expect(() => parseMp4Text(replace(bytes, 'stts', fullBox('stts', 0, 0, uint32(1), uint32(0xffffffff), uint32(1))))).toThrow()
})

it('applies leading empty edits, trimmed media and signed composition offsets', () => {
  const base = moov(fixture()), trak = child(base, 'trak'), mdia = child(trak, 'mdia'), minf = child(mdia, 'minf'), stbl = child(minf, 'stbl')
  const ctts = fullBox('ctts', 1, 0, uint32(1), uint32(3), uint32(0xfffffe0c)) // -500 ms
  let edited = replace(base, 'stbl', box('stbl', stbl.slice(8), ctts))
  const track = child(edited, 'trak'), edits = fullBox('elst', 0, 0, uint32(2), uint32(2000), uint32(0xffffffff), uint16(1), uint16(0), uint32(1500), uint32(1000), uint16(1), uint16(0))
  edited = replace(edited, 'trak', box('trak', track.slice(8), box('edts', edits)))
  expect(parseMp4Text(edited)[0].samples).toMatchObject([{ start: 2, end: 2.5 }, { start: 2.5, end: 3.5 }])
  const invalidRate = fullBox('elst', 0, 0, uint32(1), uint32(3000), uint32(0), uint16(2), uint16(0))
  expect(() => parseMp4Text(replace(edited, 'elst', invalidRate))).toThrow()
})

it('bounds malformed boxes, entry counts, timelines, offsets and sample bytes before expansion', () => {
  const base = moov(fixture())
  for (const replacement of [fullBox('stsz', 0, 0, uint32(1), uint32(20001)), fullBox('stsz', 0, 0, uint32(200000), uint32(3))]) expect(() => parseMp4Text(replace(base, 'stsz', replacement))).toThrow()
  expect(() => parseMp4Text(replace(base, 'stts', fullBox('stts', 0, 0, uint32(1), uint32(3), uint32(0xffffffff))))).toThrow()
  expect(() => parseMp4Text(replace(base, 'stco', fullBox('co64', 0, 0, uint32(3), uint64(Number.MAX_SAFE_INTEGER), uint64(1), uint64(1))))).toThrow()
  expect(() => parseMp4Text(base.slice(0, -1))).toThrow()
  expect(() => parseMp4Text(box('moov', base.slice(8), box('mvex')))).toThrow('Fragmented')
  const trak = child(base, 'trak'), mdia = child(trak, 'mdia'), minf = child(mdia, 'minf')
  const external = box('dinf', fullBox('dref', 0, 0, uint32(1), fullBox('url ', 0, 0, new TextEncoder().encode('https://other.test/data\0'))))
  expect(() => parseMp4Text(replace(base, 'minf', box('minf', minf.slice(8), external)))).toThrow('separate file')
})

it('decodes UTF-8 and BOM UTF-16 while refusing truncated or oversized captions', () => {
  expect(decodeMp4Text(new Uint8Array([0, 6, 0xfe, 0xff, 0, 72, 0, 105]))).toBe('Hi')
  expect(decodeMp4Text(new Uint8Array([0, 6, 0xff, 0xfe, 72, 0, 105, 0]))).toBe('Hi')
  expect(decodeMp4Text(tx3gCluster(['<b>literal</b>\r\ntext'])[0])).toBe('<b>literal</b>\ntext')
  expect(() => decodeMp4Text(new Uint8Array([0, 4, 65]))).toThrow()
  expect(() => decodeMp4Text(new Uint8Array([0, 2, 0xc0, 0x80]))).toThrow()
  expect(() => decodeMp4Text(tx3gCluster(['x'.repeat(4097)])[0])).toThrow()
})

it('reads a trailing moov past a large mdat even when Content-Range is hidden', async () => {
  const base = buildMp4({ tracks: [{ trackId: 1, mediaType: 'text', language: 'eng', sampleClusters: [tx3gCluster(['text'])] }], moovPosition: 'after-mdat', mdatLeadingPadding: 100000, use64BitMdatHeader: true })
  const requests = serve(base, { hidden: true })
  const session = await openMp4Subtitles({ url: 'https://example.test/movie.mp4?token=private', playback: { headers: { Authorization: 'media-only' } } }, new AbortController().signal, parser)
  expect(session.tracks).toHaveLength(1); expect(requests.some(r => r.start === base.moovOffset)).toBe(true)
  expect(requests[0].init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', headers: { Authorization: 'media-only' } })
})

it('enforces range status, exact offsets, truncation and streamed byte limits', async () => {
  for (const option of [{ status: 200 }, { shift: 1 }, { tooLarge: true }, { truncate: true }]) {
    serve(fixture(), option)
    await expect(openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, new AbortController().signal, parser)).rejects.toThrow()
  }
  expect(mp4SubtitleProblem({ url: 'https://example.test/movie.mp4', playback: { drm: { system: 'com.widevine.alpha' } } })).toContain('player')
  expect(mp4SubtitleProblem({ url: 'https://example.test/movie.mp4', playback: { headers: { Cookie: 'secret' } } })).toContain('headers')
  expect(mp4SubtitleProblem({ url: 'file:///private/movie.mp4' })).toBeTruthy()
})

it('caches subtitle samples within one session and detects changed video metadata', async () => {
  const base = fixture({ sampleDurationTicks: 30000 }), requests = serve(base)
  const session = await openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, new AbortController().signal, parser)
  await session.read(1, 0, new AbortController().signal); const first = requests.length
  await session.read(1, 10, new AbortController().signal); expect(requests).toHaveLength(first)
  await session.read(1, 70, new AbortController().signal); expect(requests.length).toBeGreaterThan(first)
  let tag = 'one'; serve(base, { tag: () => tag })
  const changed = await openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, new AbortController().signal, parser); tag = 'two'
  await expect(changed.read(1, 0, new AbortController().signal)).rejects.toThrow('changed')
})

it('cancels pending reads, redacts transport errors and terminates a timed-out parser worker', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('https://private/?token=secret'))))))
  const controller = new AbortController(), pending = openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, controller.signal, parser)
  const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled
  const timeout = expect(openMp4Subtitles({ url: 'https://example.test/movie.mp4' }, new AbortController().signal, parser)).rejects.toThrow('took too long')
  await vi.advanceTimersByTimeAsync(15000); await timeout
  const terminate = vi.fn(), postMessage = vi.fn(); vi.stubGlobal('Worker', class { terminate = terminate; postMessage = postMessage })
  const parserTimeout = expect(parseMp4Worker(new Uint8Array(1), new AbortController().signal)).rejects.toThrow('metadata took too long')
  await vi.advanceTimersByTimeAsync(10000); await parserTimeout; expect(terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})

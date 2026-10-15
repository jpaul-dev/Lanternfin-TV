import { afterEach, expect, it, vi } from 'vitest'
import { ascii, box, buildMp4, concatBytes, fullBox, tx3gSample, tx3gSampleEntry, uint16, uint32, uint64, wvttSample, wvttSampleEntry, zeros } from './helpers/mp4-fixtures'
import { decodeMp4Text, decodeMp4WebVtt, mp4BoxHeader, parseMp4Text } from '../tv-app/mp4-text'
import { openMp4Subtitles } from '../tv-app/mp4-subtitles'
afterEach(() => vi.unstubAllGlobals())
const fixture = () => buildMp4({ tracks: [{ trackId: 1, mediaType: 'text', language: 'eng', codecFourcc: 'wvtt', sampleDurationTicks: 30000, sampleClusters: [[wvttSample('<v Narrator><b>Opening</b> &amp; captions', 'Second voice'), wvttSample(), wvttSample('After seeking')]] }], moovPosition: 'after-mdat' })
const moov = () => { const data = fixture(); return data.bytes.slice(data.moovOffset, data.moovOffset + data.moovSize) }
function replace(bytes: Uint8Array, name: string, replacement: Uint8Array): Uint8Array {
  const h = mp4BoxHeader(bytes); if (h.type === name) return replacement
  if (!['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(h.type)) return bytes
  const children: Uint8Array[] = []
  for (let at = h.header; at < bytes.length;) { const next = mp4BoxHeader(bytes, at); children.push(replace(bytes.slice(at, at + next.size), name, replacement)); at += next.size }
  return box(h.type, ...children)
}

it('discovers WebVTT sample tables and preserves timing, language and codec after movie edits', () => {
  const data = moov(), parsed = parseMp4Text(data)
  expect(parsed[0]).toMatchObject({ id: 1, language: 'eng', samples: [{ codec: 'wvtt', start: 0, end: 30 }, { codec: 'wvtt', start: 30, end: 60 }, { codec: 'wvtt', start: 60, end: 90 }] })
  // A movie edit inserts two seconds, then presents the last two sample intervals.
  const children = data.slice(8), trackAt = children.findIndex((_n, i) => String.fromCharCode(...children.slice(i + 4, i + 8)) === 'trak')
  const track = children.slice(trackAt), edit = box('edts', fullBox('elst', 0, 0, uint32(2), uint32(2000), uint32(0xffffffff), uint16(1), uint16(0), uint32(60000), uint32(30000), uint16(1), uint16(0)))
  const edited = replace(data, 'trak', box('trak', track.slice(8), edit))
  expect(parseMp4Text(edited)[0].samples.map(({ start, end, codec }) => ({ start, end, codec }))).toEqual([{ start: 2, end: 32, codec: 'wvtt' }, { start: 32, end: 62, codec: 'wvtt' }])
})

it('honors the per-chunk sample description when a track switches text formats', () => {
  let data = replace(moov(), 'stsd', fullBox('stsd', 0, 0, uint32(2), tx3gSampleEntry('tx3g'), wvttSampleEntry()))
  data = replace(data, 'stsc', fullBox('stsc', 0, 0, uint32(2), uint32(1), uint32(1), uint32(1), uint32(2), uint32(1), uint32(2)))
  const samples = parseMp4Text(data)[0].samples
  expect(samples.map(sample => sample.codec)).toEqual([undefined, 'wvtt', 'wvtt'])
  expect(decodeMp4Text(tx3gSample('<b>Literal timed text</b>'), samples[0].codec)).toBe('<b>Literal timed text</b>')
  expect(decodeMp4Text(wvttSample('<b>WebVTT text</b>'), samples[1].codec)).toBe('WebVTT text')
})

it.each([
  box('wvtt', zeros(6), uint16(1)),
  box('wvtt', zeros(6), uint16(1), box('vttC', ascii('not WebVTT'))),
  box('wvtt', zeros(6), uint16(1), box('vttC', new Uint8Array([0xc0, 0x80]))),
  box('wvtt', zeros(6), uint16(1), box('vttC', ascii('WEBVTT')), box('vttC', ascii('WEBVTT'))),
  box('wvtt', zeros(6), uint16(1), box('vttC', ascii('WEBVTT' + ' '.repeat(65536)))),
])('rejects malformed WebVTT sample descriptions %#', entry => {
  expect(() => parseMp4Text(replace(moov(), 'stsd', fullBox('stsd', 0, 0, uint32(1), entry)))).toThrow()
})

it('decodes multiple simultaneous payloads and empty intervals without interpreting provider markup', () => {
  const bytes = box('vttc', box('iden', ascii('cue-1')), box('sttg', ascii('line:20% position:50%')), box('payl', ascii('<v Alice><c.red>Hello</c> &amp; <b>world</b>\r\n&lt;b&gt;literal&lt;/b&gt;\n<img src="https://example.test/image">')))
  expect(decodeMp4WebVtt(concatBytes([box('vtta', ascii('ignored source text')), bytes, wvttSample('<lang fr>Bonjour')]))).toBe('Hello & world\n<b>literal</b>\n<img src="https://example.test/image">\nBonjour')
  expect(decodeMp4WebVtt(wvttSample())).toBe(''); expect(decodeMp4WebVtt(wvttSample(''))).toBe('')
  expect(decodeMp4WebVtt(concatBytes([uint32(1), ascii('vttc'), uint64(16 + box('payl', ascii('Extended')).length), box('payl', ascii('Extended'))]))).toBe('Extended')
})

it.each([
  new Uint8Array(), new Uint8Array(7), new Uint8Array(128 * 1024 + 1),
  box('vttc'), box('vttc', box('iden', ascii('missing payload'))),
  box('vttc', box('payl', ascii('one')), box('payl', ascii('two'))),
  box('vttc', box('payl', new Uint8Array([0xc0, 0x80]))),
  concatBytes([wvttSample(), wvttSample('text')]), box('vtte', ascii('not empty')),
  concatBytes([wvttSample(), wvttSample()]), box('unknown', ascii('no cue')),
  concatBytes([wvttSample('text'), new Uint8Array([0])]),
  concatBytes([uint32(7), ascii('vttc')]), concatBytes([uint32(128), ascii('vttc')]),
  box('vttc', uint32(1), ascii('payl'), uint64(9007199254740992)),
  box('vttc', uint32(99), ascii('payl'), ascii('escaped parent')),
  wvttSample(...Array(9).fill('voice')), wvttSample('x'.repeat(4097)),
  wvttSample('x'.repeat(2048), 'y'.repeat(2048)),
  concatBytes([...Array.from({ length: 128 }, () => box('free')), wvttSample('many boxes')]),
])('rejects invalid, ambiguous or over-budget WebVTT samples %#', bytes => {
  expect(() => decodeMp4WebVtt(bytes)).toThrow()
})

it('reads WebVTT through the range session, preserves gaps, seeks, caches and applies media-only headers', async () => {
  const data = fixture().bytes, calls: RequestInit[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init); const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range')!)!, start = +match[1], end = Math.min(+match[2], data.length - 1)
    return new Response(data.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${data.length}` } })
  }))
  const signal = new AbortController().signal, session = await openMp4Subtitles({ url: 'https://example.test/movie.mp4', playback: { headers: { Authorization: 'media-only' } } }, signal, async bytes => parseMp4Text(bytes))
  const first = await session.read(1, 0, signal), count = calls.length
  expect(first.timeline.at(1)).toBe('Opening & captions\nSecond voice'); expect(first.timeline.at(31)).toBe('')
  await session.read(1, 10, signal); expect(calls).toHaveLength(count)
  expect((await session.read(1, 70, signal)).timeline.at(70)).toBe('After seeking'); expect(calls.length).toBeGreaterThan(count)
  for (const init of calls) expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { Authorization: 'media-only' } })
})

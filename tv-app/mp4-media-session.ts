import { createFile, MP4BoxBuffer, DataStream, Log, type Sample, type Track } from 'mp4box'
import type { Media } from './media'
import { mp4BoxHeader } from './mp4-text'
import { guardMp4Moov, MP4_METADATA_BYTES, MP4_METADATA_ERROR } from './mp4-media-guard'
import { mp4MediaReader } from './mp4-media-range'

export type Mp4MediaTrack = { id: number; kind: 'audio' | 'video'; language: string; mime: string }
export type Mp4MediaInfo = { duration: number; tracks: Mp4MediaTrack[] }
export type Mp4MediaSegment = { next: number; done: boolean; segments: { id: number; buffer: ArrayBuffer }[] }
const bad = () => new Error(MP4_METADATA_ERROR)
const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }

/** Runs exclusively in a terminable worker. MP4Box handles muxing, not network access. */
export async function openMp4Media(media: Media, signal: AbortSignal) {
  Log.setLogLevel(Log.error)
  const read = mp4MediaReader(media), head = await read(0, 65536, signal)
  let at = 0, moov: Uint8Array | undefined, ftyp: Uint8Array | undefined
  for (let n = 0; at < head.total && n < 256; n++) {
    stopped(signal)
    const h = at + 16 <= head.bytes.length ? mp4BoxHeader(head.bytes, at) : mp4BoxHeader((await read(at, 16, signal)).bytes)
    const size = h.size || head.total - at
    if (size < h.header || !Number.isSafeInteger(at + size) || at + size > head.total) throw bad()
    if (h.type === 'moov' || h.type === 'ftyp') {
      if (size > (h.type === 'moov' ? MP4_METADATA_BYTES : 4096) || h.type === 'moov' && moov || h.type === 'ftyp' && ftyp) throw bad()
      const data = at + size <= head.bytes.length ? head.bytes.slice(at, at + size) : (await read(at, size, signal)).bytes
      if (h.type === 'moov') moov = guardMp4Moov(data); else ftyp = data
    }
    if (['moof', 'pssh'].includes(h.type)) throw bad()
    at += size
  }
  if (!moov || !ftyp || at !== head.total) throw bad()
  const file = createFile(), metadata = new Uint8Array(ftyp.length + moov.length)
  metadata.set(ftyp); metadata.set(moov, ftyp.length)
  file.onError = () => { throw bad() }
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(metadata.buffer, 0))
  const info = file.getInfo(), duration = info.duration / info.timescale
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || info.isFragmented) throw bad()
  const candidates = info.tracks.filter(t => t.type === 'audio' || t.type === 'video')
  const tracks: Mp4MediaTrack[] = candidates.map(t => ({ id: t.id, kind: t.type as 'audio' | 'video', language: /^[a-zA-Z-]{2,16}$/.test(t.language) ? t.language : 'und', mime: `${t.type}/mp4; codecs="${t.codec}"` }))
  const indices = new Map<number, Sample[]>()
  for (const track of candidates) {
    // MSE accepts ordinary AAC/B-frame priming edits; more elaborate edits need an adaptive manifest.
    if (track.edits && (track.edits.length > 1 || track.edits.some(e => e.media_time < 0 || e.media_time > track.timescale * 2 || e.media_rate_integer !== 1 || e.media_rate_fraction !== 0))) throw bad()
    const samples = file.getTrackSamplesInfo(track.id)
    if (!samples?.length || samples.length !== track.nb_samples) throw bad()
    let previous = -Infinity
    for (const sample of samples) {
      if (!Number.isSafeInteger(sample.offset) || sample.offset < 8 || !Number.isSafeInteger(sample.size) || sample.size < 1 || sample.size > 8 * 1024 * 1024 || !Number.isSafeInteger(sample.offset + sample.size) || sample.offset + sample.size > head.total || !Number.isSafeInteger(sample.dts) || sample.dts < previous || !Number.isSafeInteger(sample.cts) || !Number.isSafeInteger(sample.duration) || sample.duration <= 0 || sample.timescale !== track.timescale || sample.timescale <= 0 || sample.description_index !== 0) throw bad()
      if ((sample.cts + sample.duration) / sample.timescale > duration + 2 || sample.dts / sample.timescale < -2) throw bad()
      previous = sample.dts
    }
    indices.set(track.id, samples)
  }
  let selected: Track[] = [], cursors = new Map<number, number>(), initialized = false
  return {
    info: { duration, tracks } satisfies Mp4MediaInfo,
    initialize(ids: number[]) {
      if (initialized || !ids.length || ids.length > 2 || new Set(ids).size !== ids.length) throw bad()
      initialized = true; selected = ids.map(id => { const t = candidates.find(t => t.id === id); if (!t) throw bad(); return t })
      if (selected.filter(t => t.type === 'video').length > 1 || selected.filter(t => t.type === 'audio').length > 1) throw bad()
      for (const t of selected) file.setSegmentOptions(t.id, undefined, {})
      return [{ id: 0, buffer: file.initializeSegmentation().buffer as ArrayBuffer }]
    },
    async segment(position: number, reset = false): Promise<Mp4MediaSegment> {
      stopped(signal)
      if (!initialized || !Number.isFinite(position) || position < 0 || position >= duration) throw bad()
      let from = position
      if (reset || !cursors.size) {
        const video = selected.find(t => t.type === 'video')
        if (video) {
          const samples = indices.get(video.id)!, i = before(samples, position)
          let sync = i; while (sync > 0 && !samples[sync].is_sync) sync--
          if (!samples[sync].is_sync || position - samples[sync].dts / video.timescale > 30) throw bad()
          cursors.set(video.id, sync); from = samples[sync].dts / video.timescale
        }
        for (const t of selected) if (t.type !== 'video') cursors.set(t.id, before(indices.get(t.id)!, from))
      }
      const until = Math.min(duration, Math.max(position + 6, from + 6)), spans: { track: Track; start: number; end: number }[] = []
      const needed: Sample[] = []
      for (const track of selected) {
        const samples = indices.get(track.id)!, start = cursors.get(track.id) || 0; let end = start
        while (end < samples.length && (until === duration || samples[end].dts / track.timescale < until)) { needed.push(samples[end]); end++ }
        if (end > start) spans.push({ track, start, end })
      }
      if (!needed.length || needed.length > 16384) throw bad()
      const ranges: { start: number; end: number; samples: Sample[] }[] = []
      let bytes = 0
      for (const s of [...needed].sort((a, b) => a.offset - b.offset)) {
        bytes += s.size; if (bytes > 16 * 1024 * 1024) throw new Error('This MP4 needs more memory per playback window than this TV path allows. Try an HLS or DASH version.')
        const last = ranges[ranges.length - 1]
        if (last && s.offset >= last.start && s.offset - last.end <= 4096 && s.offset + s.size - last.start <= 2 * 1024 * 1024) { last.end = Math.max(last.end, s.offset + s.size); last.samples.push(s) }
        else ranges.push({ start: s.offset, end: s.offset + s.size, samples: [s] })
      }
      if (ranges.length > 128 || ranges.reduce((sum, r) => sum + r.end - r.start, 0) > 20 * 1024 * 1024) throw bad()
      try {
        // A single in-flight range avoids accumulating concurrent response buffers.
        for (const range of ranges) {
          const data = (await read(range.start, range.end - range.start, signal)).bytes
          for (const s of range.samples) { s.data = data.slice(s.offset - range.start, s.offset - range.start + s.size); s.alreadyRead = s.size }
        }
        stopped(signal)
        const segments = spans.map(({ track, start, end }) => {
          // MP4Box 2.4.1's typed Sample + createFragment API accepts complete sample data.
          // Copies above deliberately own their ArrayBuffers; subarray offsets are not used by its muxer.
          const fragment = file.createFragment(track.id, start, end - 1, new DataStream())
          if (!fragment || fragment.buffer.byteLength > 24 * 1024 * 1024) throw bad()
          cursors.set(track.id, end)
          return { id: track.id, buffer: fragment.buffer as ArrayBuffer }
        })
        const done = selected.every(t => cursors.get(t.id)! >= indices.get(t.id)!.length)
        const next = done ? duration : Math.min(...selected.map(t => { const s = indices.get(t.id)![cursors.get(t.id)!]; return s ? s.dts / t.timescale : duration }))
        if (!done && next <= position) throw bad()
        return { next, done, segments }
      } finally { for (const s of needed) { s.data = undefined; s.alreadyRead = 0 } }
    },
  }
}
function before(samples: Sample[], seconds: number) {
  let low = 0, high = samples.length
  while (low < high) { const mid = (low + high) >>> 1; if (samples[mid].dts / samples[mid].timescale <= seconds) low = mid + 1; else high = mid }
  return Math.max(0, low - 1)
}
export type Mp4MediaSession = Awaited<ReturnType<typeof openMp4Media>>

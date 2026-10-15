import { browserHeaderProblem, webAddress, type Media } from './media'
import { MP4_MOOV_BYTES, mp4BoxHeader, decodeMp4Text, type Mp4TextTrack } from './mp4-text'
import { SubtitleError, SubtitleTimeline, type SubtitleCue } from './external-subtitles'
import { subtitleBudget as budget, subtitleRangeReader as rangeReader } from './subtitle-range'

const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }
export function mp4SubtitleProblem(media?: Media): string | undefined {
  if (!media || media.mediaKind === 'live' || !/^https?:\/\/.*\.(?:mp4|m4v|mov)(?:[?#]|$)/i.test(media.url)) return 'Embedded scanning is available for HTTP MP4, M4V and MOV videos.'
  if (media.playback?.drm || media.playback?.problem || media.playback?.manifestType) return 'This stream needs its player’s own subtitle support.'
  if (browserHeaderProblem(media.playback?.headers) || Object.keys(media.playback?.headers || {}).some(key => /^(range|if-range)$/i.test(key))) return 'This video requires request headers the embedded subtitle reader cannot safely apply.'
  try { webAddress(media.url) } catch { return 'This video address is not supported by the subtitle reader.' }
}

export function parseMp4Worker(bytes: Uint8Array, signal: AbortSignal): Promise<Mp4TextTrack[]> {
  return new Promise((resolve, reject) => {
    stopped(signal)
    let worker: Worker
    try { worker = new Worker('mp4-text-worker.js') } catch { reject(new SubtitleError('This TV cannot start the embedded subtitle reader. Reinstall the complete app package.')); return }
    const done = (error?: Error, tracks?: Mp4TextTrack[]) => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(tracks!) }
    const abort = () => done(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => done(new SubtitleError('The MP4 subtitle metadata took too long to read.')), 10000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => done(new SubtitleError('The embedded subtitle reader failed. Reinstall the complete app package or try another video.'))
    worker.onmessage = event => event.data?.error || !Array.isArray(event.data?.tracks) ? done(new SubtitleError('This MP4 has unsupported, oversized or malformed subtitle tables.')) : done(undefined, event.data.tracks)
    try { worker.postMessage(bytes.buffer, [bytes.buffer]) } catch { done(new SubtitleError('The MP4 metadata could not be sent to the subtitle reader.')) }
  })
}

export function openMp4Subtitles(media: Media, signal: AbortSignal, parse = parseMp4Worker) { return budget(signal, child => openSession(media, child, parse)) }
async function openSession(media: Media, signal: AbortSignal, parse: typeof parseMp4Worker) {
  const problem = mp4SubtitleProblem(media); if (problem) throw new SubtitleError(problem)
  const read = rangeReader(media), head = await read(0, 65536, signal, true)
  let at = 0, tracks: Mp4TextTrack[] | undefined
  for (let count = 0; count < 256; count++) {
    stopped(signal)
    if (head.total !== undefined && at >= head.total) break
    const header = at + 16 <= head.bytes.length ? mp4BoxHeader(head.bytes, at) : mp4BoxHeader((await read(at, 16, signal, true)).bytes)
    const size = header.size || (head.total === undefined ? 0 : head.total - at)
    if (!size || !Number.isSafeInteger(at + size) || head.total !== undefined && at + size > head.total) throw new SubtitleError('This MP4 has an incomplete or invalid box layout.')
    if (header.type === 'moov') {
      if (size > MP4_MOOV_BYTES) throw new SubtitleError('This video’s MP4 metadata exceeds the 32 MB subtitle-reader limit.')
      const moov = at + size <= head.bytes.length ? head.bytes.slice(at, at + size) : (await read(at, size, signal)).bytes
      tracks = await parse(moov, signal); break
    }
    at += size
  }
  if (!tracks) throw new SubtitleError('No supported MP4 metadata was found within the subtitle scan limit.')
  // Cache is scoped to this playback session, never shared by URL or saved with provider credentials.
  const cache = new Map<string, string>(); let characters = 0
  return {
    tracks,
    read(trackId: number, position: number, signal: AbortSignal) { return budget(signal, async signal => {
      stopped(signal)
      const track = tracks!.find(track => track.id === trackId)
      if (!track || !Number.isFinite(position) || position < 0) throw new SubtitleError('This embedded subtitle track is no longer available.')
      const from = Math.max(0, position - 5), to = position + 45
      const wanted: (Mp4TextTrack['samples'][number] & { key: string })[] = []
      for (let index = 0; index < track.samples.length; index++) { const sample = track.samples[index]; if (sample.end > from && sample.start < to) wanted.push({ ...sample, key: `${trackId}:${index}` }) }
      if (wanted.length > 512) throw new SubtitleError('This subtitle track has too many overlapping samples for the TV reader.')
      const missing = wanted.filter(sample => !cache.has(sample.key)).sort((a, b) => a.offset - b.offset)
      const ranges: { start: number; end: number; samples: typeof missing }[] = []
      for (const sample of missing) {
        if (head.total !== undefined && sample.offset + sample.size > head.total) throw new SubtitleError('This subtitle track points outside the video file.')
        const previous = ranges[ranges.length - 1]
        if (previous && sample.offset - previous.end <= 4096 && sample.offset + sample.size - previous.start <= 256 * 1024) { previous.end = Math.max(previous.end, sample.offset + sample.size); previous.samples.push(sample) }
        else ranges.push({ start: sample.offset, end: sample.offset + sample.size, samples: [sample] })
      }
      if (ranges.length > 128 || ranges.reduce((sum, range) => sum + range.end - range.start, 0) > 2 * 1024 * 1024) throw new SubtitleError('This subtitle window exceeds the TV reader’s request or byte limit.')
      const staged = new Map<string, string>(); let next = 0
      await Promise.all(Array.from({ length: Math.min(3, ranges.length) }, async () => {
        while (next < ranges.length) {
          stopped(signal); const range = ranges[next++], data = (await read(range.start, range.end - range.start, signal)).bytes
          for (const sample of range.samples) {
            let text: string
            try { text = decodeMp4Text(data.subarray(sample.offset - range.start, sample.offset - range.start + sample.size), sample.codec) }
            catch { throw new SubtitleError('This MP4 contains invalid or oversized text subtitle samples.') }
            staged.set(sample.key, text)
          }
        }
      }))
      stopped(signal)
      const cues: SubtitleCue[] = []
      for (const sample of wanted) {
        const text = staged.get(sample.key) ?? cache.get(sample.key)!
        if (cache.has(sample.key)) { characters -= cache.get(sample.key)!.length; cache.delete(sample.key) }
        cache.set(sample.key, text); characters += text.length
        if (text) cues.push({ start: sample.start, end: sample.end, text })
      }
      while (cache.size > 2000 || characters > 2 * 1024 * 1024) { const key = cache.keys().next().value!; characters -= cache.get(key)!.length; cache.delete(key) }
      return { timeline: new SubtitleTimeline(cues), from, to }
    }) },
  }
}
export type Mp4SubtitleSession = Awaited<ReturnType<typeof openMp4Subtitles>>

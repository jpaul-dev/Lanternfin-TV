import { browserHeaderProblem, webAddress, type Media } from './media'
import { SubtitleError, SubtitleTimeline, type SubtitleCue } from './external-subtitles'
import { subtitleBudget, subtitleRangeReader } from './subtitle-range'
import { MKV, MKV_METADATA_BYTES, ebmlHeader, ebmlUint, mkvSeekEntries, validateMkvHeader, decodeMkvCue, type EbmlElement, type MkvMetadataInput, type MkvTextTrack, type MkvCue } from './mkv-text'

const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }
const layoutError = () => new SubtitleError('This MKV has an incomplete or unsupported subtitle index. Use native tracks or load an external subtitle file.')
type Metadata = { scale: number; tracks: MkvTextTrack[] }
type Element = EbmlElement & { offset: number }
type Read = (start: number, length: number, signal: AbortSignal, short?: boolean) => Promise<Uint8Array>

export function mkvSubtitleProblem(media?: Media): string | undefined {
  if (!media || media.mediaKind === 'live' || !/^https?:\/\/.*\.mkv(?:[?#]|$)/i.test(media.url)) return 'Embedded MKV scanning is available for HTTP MKV videos.'
  if (media.playback?.drm || media.playback?.problem || media.playback?.manifestType) return 'This stream needs its player’s own subtitle support.'
  if (browserHeaderProblem(media.playback?.headers) || Object.keys(media.playback?.headers || {}).some(key => /^(range|if-range)$/i.test(key))) return 'This video requires request headers the embedded subtitle reader cannot safely apply.'
  try { webAddress(media.url) } catch { return 'This video address is not supported by the subtitle reader.' }
}
export function parseMkvWorker(input: MkvMetadataInput, signal: AbortSignal): Promise<Metadata> {
  return new Promise((resolve, reject) => {
    stopped(signal); let worker: Worker
    try { worker = new Worker('mkv-text-worker.js') } catch { reject(new SubtitleError('This TV cannot start the embedded subtitle reader. Reinstall the complete app package.')); return }
    let finished = false
    const done = (error?: Error, metadata?: Metadata) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(metadata!) }
    const abort = () => done(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => done(new SubtitleError('The MKV subtitle metadata took too long to read.')), 10000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => done(new SubtitleError('The embedded subtitle reader failed. Reinstall the complete app package or try another video.'))
    worker.onmessage = event => event.data?.error || !Array.isArray(event.data?.metadata?.tracks) ? done(new SubtitleError('This MKV has unsupported, oversized or malformed subtitle tables.')) : done(undefined, event.data.metadata)
    try { worker.postMessage(input, [input.info.buffer, input.tracks.buffer, input.cues.buffer]) } catch { done(new SubtitleError('The MKV metadata could not be sent to the subtitle reader.')) }
  })
}

async function elementAt(read: Read, offset: number, end: number, signal: AbortSignal): Promise<Element> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= end) throw layoutError()
  const header = ebmlHeader(await read(offset, Math.min(12, end - offset), signal, true))
  const data = offset + header.data, stop = header.end === undefined ? undefined : offset + header.end
  if (data > end || stop !== undefined && (!Number.isSafeInteger(stop) || stop > end)) throw layoutError()
  return { ...header, offset, data, end: stop }
}
function limited(read: Read, maxBytes: number, maxRequests: number): Read {
  let bytes = 0, requests = 0
  return (start, length, signal, short) => {
    stopped(signal); bytes += length
    if (++requests > maxRequests || bytes > maxBytes) throw new SubtitleError('This MKV subtitle read exceeds the TV request or byte limit. Use native tracks or an external subtitle file.')
    return read(start, length, signal, short)
  }
}
export function openMkvSubtitles(media: Media, signal: AbortSignal, parse = parseMkvWorker) { return subtitleBudget(signal, child => openSession(media, child, parse)) }
async function openSession(media: Media, signal: AbortSignal, parse: typeof parseMkvWorker) {
  const problem = mkvSubtitleProblem(media); if (problem) throw new SubtitleError(problem)
  const range = subtitleRangeReader(media, MKV_METADATA_BYTES), head = await range(0, 65536, signal, true)
  const read: Read = async (start, length, signal, short = false) => {
    stopped(signal)
    if (start + length <= head.bytes.length) return head.bytes.slice(start, start + length)
    return (await range(start, length, signal, short)).bytes
  }
  const metadataRead = limited(read, 9 * 1024 * 1024, 256), fileEnd = head.total ?? Number.MAX_SAFE_INTEGER
  const ebml = await elementAt(metadataRead, 0, fileEnd, signal)
  if (ebml.id !== MKV.ebml || ebml.size === undefined || ebml.size > 4096) throw layoutError()
  validateMkvHeader(await metadataRead(ebml.data, ebml.size, signal))
  let segment = await elementAt(metadataRead, ebml.end!, fileEnd, signal)
  for (let i = 0; segment.id !== MKV.segment && i < 16; i++) {
    if (![0xec, 0xbf].includes(segment.id) || segment.end === undefined) throw layoutError()
    segment = await elementAt(metadataRead, segment.end, fileEnd, signal)
  }
  if (segment.id !== MKV.segment || segment.end === undefined && head.total === undefined) throw layoutError()
  const end = segment.end ?? head.total!, needed = new Map<number, Uint8Array>(), visited = new Set<number>()
  const queue: { position: number; id?: number }[] = [{ position: segment.data }]
  let seekHeads = 0
  while (queue.length && needed.size < 3) {
    stopped(signal); const task = queue.shift()!
    if (visited.has(task.position)) continue
    if (visited.size >= 256) throw layoutError(); visited.add(task.position)
    const element = await elementAt(metadataRead, task.position, end, signal)
    if (task.id !== undefined && element.id !== task.id) throw layoutError()
    if ([MKV.info, MKV.tracks, MKV.cues, MKV.seek].includes(element.id)) {
      const max = element.id === MKV.cues ? MKV_METADATA_BYTES : element.id === MKV.tracks ? 512 * 1024 : 65536
      if (element.size === undefined || element.size > max) throw layoutError()
      const data = element.size ? await metadataRead(element.data, element.size, signal) : new Uint8Array()
      if (element.id === MKV.seek) {
        if (++seekHeads > 8) throw layoutError()
        for (const entry of mkvSeekEntries(data, segment.data, end)) if (!visited.has(entry.position)) queue.unshift(entry)
      } else {
        if (needed.has(element.id)) throw layoutError()
        needed.set(element.id, data)
      }
    }
    // Skip sized media/attachments by their headers; never download them to find Cues.
    if (element.end !== undefined && element.end < end) queue.push({ position: element.end })
  }
  if (needed.size !== 3) throw layoutError()
  const metadata = await parse({ info: needed.get(MKV.info)!, tracks: needed.get(MKV.tracks)!, cues: needed.get(MKV.cues)!, segment: segment.data, end }, signal)
  // Metadata is kept for this playback session only. Text cache is bounded and
  // a failed/cancelled window cannot publish a partial set of captions.
  const cache = new Map<string, SubtitleCue>(); let characters = 0
  const clusters = new Map<number, { data: number; end: number; time: number }>()
  async function clusterAt(position: number, read: Read, signal: AbortSignal) {
    const cached = clusters.get(position); if (cached) return cached
    const cluster = await elementAt(read, position, end, signal)
    if (cluster.id !== MKV.cluster) throw layoutError()
    const stop = cluster.end ?? end; let at = cluster.data
    for (let i = 0; i < 64 && at < stop; i++) {
      const item = await elementAt(read, at, stop, signal)
      if (item.id === 0xe7) {
        if (item.size === undefined || item.size > 8) throw layoutError()
        const time = item.size ? ebmlUint(await read(item.data, item.size, signal)) : 0
        const result = { data: cluster.data, end: stop, time }; clusters.set(position, result)
        if (clusters.size > 64) clusters.delete(clusters.keys().next().value!)
        return result
      }
      if (item.end === undefined || [MKV.cluster, MKV.cues].includes(item.id)) break
      at = item.end
    }
    throw layoutError()
  }
  async function readCue(track: MkvTextTrack, cue: MkvCue, read: Read, signal: AbortSignal) {
    const cluster = await clusterAt(cue.cluster, read, signal)
    let at = cue.relative === undefined ? cluster.data : cluster.data + cue.relative, block = 0
    for (let i = 0; i < 4096 && at < cluster.end; i++) {
      const item = await elementAt(read, at, cluster.end, signal)
      if (item.end === undefined || [MKV.cluster, MKV.cues].includes(item.id)) throw layoutError()
      if ([0xa0, 0xa3].includes(item.id)) {
        block++
        if (cue.relative !== undefined || block === cue.block) {
          const size = item.end - item.offset
          if (size > 65536) throw layoutError()
          return decodeMkvCue(await read(item.offset, size, signal), track, cue, cluster.time, metadata.scale)
        }
      }
      if (cue.relative !== undefined) throw layoutError()
      at = item.end
    }
    throw layoutError()
  }
  return {
    tracks: metadata.tracks,
    read(trackId: number, position: number, signal: AbortSignal) { return subtitleBudget(signal, async signal => {
      const track = metadata.tracks.find(track => track.id === trackId)
      if (!track || !Number.isFinite(position) || position < 0) throw new SubtitleError('This embedded subtitle track is no longer available.')
      const from = Math.max(0, position - 5), to = position + 45
      const wanted: { sample: MkvCue; key: string }[] = []
      for (let index = 0; index < track.samples.length; index++) {
        const sample = track.samples[index], key = `${trackId}:${index}`
        if (sample.start >= to) break
        if ((sample.end ?? cache.get(key)?.end ?? Infinity) <= from) continue
        wanted.push({ sample, key })
        if (wanted.length > 512) throw new SubtitleError('This MKV index has too many overlapping or undated subtitles at this position. Use native tracks or an external subtitle file.')
      }
      const missing = wanted.filter(item => !cache.has(item.key)), staged = new Map<string, SubtitleCue>(), windowRead = limited(read, 2 * 1024 * 1024, 128)
      let next = 0
      await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
        while (next < missing.length) { stopped(signal); const item = missing[next++]; staged.set(item.key, await readCue(track, item.sample, windowRead, signal)) }
      }))
      stopped(signal); const cues: SubtitleCue[] = []
      for (const item of wanted) {
        const cue = staged.get(item.key) ?? cache.get(item.key)!
        if (cache.has(item.key)) { characters -= cache.get(item.key)!.text.length; cache.delete(item.key) }
        cache.set(item.key, cue); characters += cue.text.length
        if (cue.text && cue.start < to && cue.end > from) cues.push(cue)
      }
      while (cache.size > 2000 || characters > 2 * 1024 * 1024) { const key = cache.keys().next().value!; characters -= cache.get(key)!.text.length; cache.delete(key) }
      return { timeline: new SubtitleTimeline(cues), from, to }
    }) },
  }
}
export type MkvSubtitleSession = Awaited<ReturnType<typeof openMkvSubtitles>>

import { browserHeaderProblem, webAddress, type Media } from './media'
import { fetchSubtitleResponse as fetchResponse, cancelSubtitleResponse as cancelResponse, readResponsePrefix } from './subtitle-stream'

type Format = 'hls' | 'dash' | 'mp4' | 'mpegts' | 'm2ts' | 'flv' | 'other'
const extensions: Record<string, Format> = { m3u8: 'hls', mpd: 'dash', mp4: 'mp4', m4v: 'mp4', mov: 'mp4', m4a: 'mp4', ts: 'mpegts', mpegts: 'mpegts', m2ts: 'm2ts', flv: 'flv', mkv: 'other', webm: 'other', weba: 'other', mp3: 'other', ogg: 'other', ogv: 'other', opus: 'other', wav: 'other', aac: 'other' }
const mimes: Record<string, Format> = { 'application/vnd.apple.mpegurl': 'hls', 'application/x-mpegurl': 'hls', 'audio/mpegurl': 'hls', 'audio/x-mpegurl': 'hls', 'application/dash+xml': 'dash', 'video/mp4': 'mp4', 'audio/mp4': 'mp4', 'application/mp4': 'mp4', 'video/quicktime': 'mp4', 'video/mp2t': 'mpegts', 'video/x-flv': 'flv' }
const ERROR = 'This stream format could not be identified with its required headers. Check provider access and cross-origin permissions, or use a provider HLS, DASH or MP4 address.'
const lookup = (values: Record<string, Format>, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
export function mediaFormat(media: Media): Format | undefined {
  const declared = media.playback?.manifestType?.toLowerCase()
  if (declared) return declared === 'hls' || declared === 'dash' ? declared : lookup(extensions, declared) || 'other'
  try { return lookup(extensions, new URL(media.url).pathname.split('.').pop()!.toLowerCase()) } catch { return undefined }
}
export function needsMediaProbe(media: Media) {
  return !!Object.keys(media.playback?.headers || {}).length && !media.playback?.problem && !browserHeaderProblem(media.playback?.headers) && !mediaFormat(media)
}
function sniff(bytes: Uint8Array): Format | undefined {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trimStart()
  if (/^#EXTM3U(?:\s|$)/.test(text)) return 'hls'
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD(?:\s|>)/.test(text)) return 'dash'
  if (bytes.length >= 12 && ['ftyp', 'moov', 'mdat', 'free', 'wide'].includes(String.fromCharCode(...bytes.subarray(4, 8)))) return 'mp4'
  if (bytes.length >= 9 && bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56 && bytes[3] === 1) return 'flv'
  if (bytes.length > 376 && [0, 188, 376].every(i => bytes[i] === 0x47)) return 'mpegts'
  if (bytes.length > 388 && [4, 196, 388].every(i => bytes[i] === 0x47)) return 'm2ts'
}
/** One bounded probe; it neither follows authenticated redirects nor reads a full movie. */
export async function resolveMediaFormat(media: Media, signal: AbortSignal): Promise<Media> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (!needsMediaProbe(media)) return media
  if (Object.keys(media.playback?.headers || {}).some(name => /^(range|if-range)$/i.test(name))) throw new Error(ERROR)
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 10000)
  signal.addEventListener('abort', abort, { once: true })
  let response: Response | undefined
  try {
    response = await fetchResponse(webAddress(media.url), { headers: { ...media.playback?.headers, Range: 'bytes=0-4095' }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' })
    if (![200, 206].includes(response.status) || response.redirected) throw new Error()
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const format = lookup(mimes, mime) || (response.body ? sniff(await readResponsePrefix(response.body, 4096, controller.signal)) : undefined)
    if (!format || controller.signal.aborted) throw new Error()
    return { ...media, playback: { ...media.playback, manifestType: format } }
  } catch {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    throw new Error(ERROR)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); cancelResponse(response) }
}

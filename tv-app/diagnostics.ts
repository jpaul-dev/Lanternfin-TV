import type { Media } from './media'
import type { State } from './player'
import type { DRMReport } from './drm-support'

export type PlayerStats = { engine?: 'html' | 'shaka' | 'mpegts' | 'mp4' | 'samsung'; width?: number; height?: number; decodedFrames?: number; droppedFrames?: number; bandwidth?: number; bufferedSeconds?: number }
export function safeStats(raw: PlayerStats = {}): PlayerStats {
  const value: PlayerStats = {}
  if (['html', 'shaka', 'mpegts', 'mp4', 'samsung'].includes(raw.engine || '')) value.engine = raw.engine
  for (const key of ['width', 'height', 'decodedFrames', 'droppedFrames', 'bandwidth', 'bufferedSeconds'] as const) {
    const number = raw[key]
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1e12) value[key] = Math.round(number * 10) / 10
  }
  return value
}
type Event = { seconds: number; state: State | 'open'; code?: number }
/** An allowlist, not a regex scrubber: arbitrary provider strings never enter this log. */
export class PlaybackDiagnostics {
  private started = Date.now()
  private events: Event[] = []
  private media?: { source: string; kind: string; drm: string; mediaHeaders: number; licenseHeaders: number; licenseWrapper: boolean; format: string }
  private stats: PlayerStats = {}
  begin(media: Media, source: string) {
    const drm = media.playback?.drm
    const path = (() => { try { return new URL(media.url).pathname.toLowerCase() } catch { return '' } })()
    this.media = {
      source: ['playlist', 'xtream', 'direct'].includes(source) ? source : 'unknown',
      kind: ['live', 'movie', 'series', 'episode'].includes(media.mediaKind || '') ? media.mediaKind! : 'unknown',
      drm: !drm ? 'none' : ['com.widevine.alpha', 'com.microsoft.playready', 'org.w3.clearkey'].includes(drm.system) ? drm.system : 'other',
      mediaHeaders: Math.min(1000, Object.keys(media.playback?.headers || {}).length),
      licenseHeaders: Math.min(1000, Object.keys(drm?.headers || {}).length), licenseWrapper: !!drm?.format,
      format: ['hls', 'dash', 'mpd', 'mpegts', 'ts', 'm2ts', 'flv'].includes(media.playback?.manifestType || '') ? media.playback!.manifestType! : ['m3u8', 'mpd', 'mp4', 'webm', 'mkv', 'ts', 'm2ts', 'flv'].find(ext => path.endsWith(`.${ext}`)) || 'unknown',
    }
    this.stats = {}; this.add('open')
  }
  record(state: State, detail?: string) {
    if (!['loading', 'playing', 'paused', 'buffering', 'ended', 'error', 'idle'].includes(state)) return
    // Only the numeric Shaka error code, never its response body, URL or message.
    const match = detail?.match(/\(code (\d{1,7})\)/)
    const code = match ? Number(match[1]) : undefined
    if (this.events[this.events.length - 1]?.state === state && this.events[this.events.length - 1]?.code === code) return
    this.add(state, code)
  }
  sample(stats?: PlayerStats) { const next = safeStats(stats); if (Object.keys(next).length) this.stats = next }
  private add(state: Event['state'], code?: number) {
    this.events.push({ seconds: Math.max(0, Math.round((Date.now() - this.started) / 1000)), state, ...(code === undefined ? {} : { code }) })
    if (this.events.length > 80) this.events.shift()
  }
  clear() { this.events = []; this.stats = {}; this.media = undefined; this.started = Date.now() }
  snapshot() { return { ...(this.media ? { stream: { ...this.media } } : {}), player: { ...this.stats }, events: this.events.map(event => ({ ...event })) } }
}

const TYPES = {
  'H.264 video': 'video/mp4; codecs="avc1.42E01E"', 'HEVC video': 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  'VP9 video': 'video/webm; codecs="vp9"', 'AV1 video': 'video/mp4; codecs="av01.0.05M.08"',
  'AAC audio': 'audio/mp4; codecs="mp4a.40.2"', 'AC-3 audio': 'audio/mp4; codecs="ac-3"',
} as const
export function capabilities(video: HTMLVideoElement, win = window, nav = navigator) {
  const mse = (win as Window & { MediaSource?: typeof MediaSource }).MediaSource
  return {
    online: nav.onLine, secureContext: win.isSecureContext === true, mediaSource: !!mse,
    encryptedMediaAPI: typeof nav.requestMediaKeySystemAccess === 'function',
    encryptedBackup: !!win.crypto?.subtle, workers: typeof Worker !== 'undefined',
    codecs: Object.entries(TYPES).map(([name, mime]) => {
      let native: 'probably' | 'maybe' | 'not-reported' = 'not-reported', mediaSource = false
      try { const result = video.canPlayType(mime); if (result === 'probably' || result === 'maybe') native = result } catch {}
      try { mediaSource = mse?.isTypeSupported(mime) === true } catch {}
      return { name, native, mediaSource }
    }),
  }
}
export type DiagnosticReport = { schema: 1; app: { version: string; target: string; commit: string; modified: boolean }; capabilities: ReturnType<typeof capabilities>; samsungPlayer: boolean; screenSaver: string; playback: ReturnType<PlaybackDiagnostics['snapshot']>; drm?: DRMReport }
declare const __TV_BUILD__: { version: string; commit: string; dirty: boolean }
export function buildInfo(target: 'webos' | 'tizen' | 'browser') {
  const build = typeof __TV_BUILD__ === 'undefined' ? { version: '0.1.0', commit: '', dirty: true } : __TV_BUILD__
  return { version: /^\d+\.\d+\.\d+$/.test(build.version) ? build.version : 'unknown', target, commit: /^[a-f0-9]{40}$/.test(build.commit) ? build.commit : 'development', modified: build.dirty === true }
}

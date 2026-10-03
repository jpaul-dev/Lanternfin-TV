import { httpUrl } from './catalog'
import type { Media } from './media'
export type State = 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error' | 'idle'
export type Report = (state: State, detail?: string) => void
export type PlayerTrack = { id: string; kind: 'audio' | 'subtitle'; label: string; language?: string; active: boolean; disabled?: boolean }
export type Aspect = 'fit' | 'zoom' | 'stretch'
export type VideoQuality = { id: string; label: string; active: boolean }
export interface Player { play(url: string | Media, position?: number): void; pause(): void; resume(): void; seek(delta: number): void; stop(): void; timeline(): { position: number; duration: number }; tracks?(): PlayerTrack[]; selectTrack?(kind: PlayerTrack['kind'], id: string): boolean; qualities?(): VideoQuality[]; selectQuality?(id: string): boolean; aspects?(): Aspect[]; setAspect?(aspect: Aspect): boolean; speeds?(): number[]; speed?(): number; setSpeed?(rate: number): boolean }
type NativeTrack = { type: string; index: number; extra_info?: string }
export interface AVPlay {
  open(url: string): void; close(): void; stop(): void; play(): void; pause(): void
  getState(): string; getDuration(): number; getCurrentTime(): number
  setDisplayRect(x: number, y: number, width: number, height: number): void
  setDisplayMethod(method: string): void
  setSpeed?(rate: number): void
  setStreamingProperty?(name: string, value: string): void
  getTotalTrackInfo?(): NativeTrack[]; getCurrentStreamInfo?(): NativeTrack[]
  setSelectTrack?(type: 'AUDIO' | 'TEXT', index: number): void; setSilentSubtitle?(hidden: boolean): void
  setListener(listener: Record<string, (...args: any[]) => void>): void
  prepareAsync(success: () => void, failure: () => void): void
  seekTo(milliseconds: number, success: () => void, failure: () => void): void
}
const PLAYBACK_ERROR = 'This stream could not play. Check your network and provider access, then retry. The stream’s codec or format may not be supported on this device.'

export function samsungPlayer(api: AVPlay, report: Report): Player {
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, seeking = false
  let subtitlesHidden = true, dash = false, speed = 1, live = false
  const close = () => {
    generation++; seeking = false; speed = 1; clearTimeout(timer)
    try { if (['READY', 'PLAYING', 'PAUSED'].includes(api.getState())) api.stop() } catch { /* close still releases the decoder */ }
    try { api.close() } catch { /* NONE is already closed */ }
  }
  const fail = () => { close(); report('error', PLAYBACK_ERROR) }
  return {
    play(url, position = 0) {
      close()
      const token = generation
      try {
        const media = typeof url === 'string' ? { url } : url
        live = media.mediaKind === 'live'
        if (media.playback?.drm || media.playback?.problem) throw new Error('Use the adaptive player for DRM.')
        api.open(httpUrl(media.url))
        dash = /\.mpd(?:\?|$)/i.test(media.url) || ['mpd', 'dash'].includes(media.playback?.manifestType || '')
        subtitlesHidden = true
        try { api.setSilentSubtitle?.(true) } catch { /* Optional subtitle support must not prevent video playback. */ }
        for (const [name, value] of Object.entries(media.playback?.headers || {})) {
          const property = name.toLowerCase() === 'user-agent' ? 'USER_AGENT' : name.toLowerCase() === 'cookie' ? 'COOKIE' : ''
          if (!property || !api.setStreamingProperty) throw new Error('Unsupported native header.')
          api.setStreamingProperty(property, value)
        }
        api.setDisplayRect(0, 0, 1920, 1080)
        api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX')
        api.setListener({
          onbufferingstart: () => { if (token === generation) { if (api.getState() === 'PLAYING') { clearTimeout(timer); timer = setTimeout(() => { if (token === generation) fail() }, 60000) } report('buffering') } },
          onbufferingcomplete: () => { if (token === generation) { const state = api.getState(); if (['PAUSED', 'PLAYING'].includes(state)) clearTimeout(timer); report(state === 'PAUSED' ? 'paused' : state === 'PLAYING' ? 'playing' : 'loading') } },
          onstreamcompleted: () => { if (token === generation) { close(); report('ended') } },
          onerror: () => { if (token === generation) fail() },
        })
        report('loading')
        timer = setTimeout(() => { if (token === generation) fail() }, 30000)
        api.prepareAsync(() => {
          if (token !== generation) return
          clearTimeout(timer)
          try {
            const begin = () => { if (token === generation) { try { api.play(); report('playing') } catch { fail() } } }
            const duration = api.getDuration()
            if (position > 0 && Number.isFinite(duration) && duration > (position + 1) * 1000) {
              // The same generation guard protects both seek completion paths.
              timer = setTimeout(() => { if (token === generation) fail() }, 30000)
              api.seekTo(position * 1000, () => { if (token === generation) { clearTimeout(timer); begin() } }, () => { if (token === generation) { clearTimeout(timer); begin() } })
            } else begin()
          } catch { fail() }
        }, () => { if (token === generation) fail() })
      } catch { fail() }
    },
    pause() { try { if (api.getState() === 'PLAYING') { api.pause(); clearTimeout(timer); report('paused') } } catch { fail() } },
    resume() { try { if (api.getState() === 'PAUSED') { api.play(); report('playing') } } catch { fail() } },
    seek(delta) {
      try {
        if (seeking || !['PLAYING', 'PAUSED'].includes(api.getState())) return
        const duration = api.getDuration()
        if (!Number.isFinite(duration) || duration <= 1000) return // live edge is not a VOD timeline
        const token = generation
        seeking = true
        const finish = () => { if (token === generation) seeking = false }
        api.seekTo(Math.max(0, Math.min(duration - 1000, api.getCurrentTime() + delta * 1000)), finish, finish)
      } catch { seeking = false }
    },
    stop() { close(); report('idle') },
    speeds() { try { return !live && api.setSpeed && ['READY', 'PLAYING', 'PAUSED'].includes(api.getState()) && Number.isFinite(api.getDuration()) && api.getDuration() > 1000 ? [1, 2] : [] } catch { return [] } },
    speed() { return speed },
    setSpeed(rate) { try { if (!this.speeds?.().includes(rate)) return false; api.setSpeed!(rate); speed = rate; return true } catch { return false } },
    aspects() { return ['fit', 'stretch'] },
    setAspect(aspect) {
      if (!['fit', 'stretch'].includes(aspect) || !['IDLE', 'READY', 'PLAYING', 'PAUSED'].includes(api.getState())) return false
      try { api.setDisplayMethod(aspect === 'stretch' ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX'); return true } catch { return false }
    },
    timeline() {
      try { return { position: api.getCurrentTime() / 1000, duration: api.getDuration() / 1000 } }
      catch { return { position: 0, duration: 0 } }
    },
    tracks() {
      try {
        if (!['PLAYING', 'PAUSED', 'READY'].includes(api.getState()) || !api.setSelectTrack) return []
        const selected = api.getCurrentStreamInfo?.() || []
        return (api.getTotalTrackInfo?.() || []).filter(track => track.type === 'AUDIO' || (track.type === 'TEXT' && !dash && !!api.setSilentSubtitle)).map(track => {
          let info: Record<string, unknown> = {}; try { info = JSON.parse(track.extra_info || '{}') || {} } catch { /* Language may be missing. */ }
          const language = typeof info.language === 'string' ? info.language : typeof info.track_lang === 'string' ? info.track_lang : ''
          return { id: String(track.index), kind: track.type === 'AUDIO' ? 'audio' as const : 'subtitle' as const, language, label: language.slice(0, 80) || `${track.type === 'AUDIO' ? 'Audio' : 'Subtitle'} ${track.index + 1}`, active: (track.type !== 'TEXT' || !subtitlesHidden) && selected.some(item => item.type === track.type && item.index === track.index), disabled: track.type === 'AUDIO' && api.getState() !== 'PLAYING' }
        })
      } catch { return [] }
    },
    selectTrack(kind, id) {
      try {
        if (!['PLAYING', 'PAUSED'].includes(api.getState())) return false
        if (kind === 'subtitle' && id === 'off') { if (!api.setSilentSubtitle) return false; api.setSilentSubtitle(true); subtitlesHidden = true; return true }
        if (!api.setSelectTrack || (kind === 'audio' && api.getState() !== 'PLAYING') || (kind === 'subtitle' && (dash || !api.setSilentSubtitle))) return false
        const type = kind === 'audio' ? 'AUDIO' : 'TEXT'
        const track = api.getTotalTrackInfo?.().find(item => item.type === type && String(item.index) === id)
        if (!track) return false
        api.setSelectTrack(type, track.index)
        if (kind === 'subtitle') { api.setSilentSubtitle!(false); subtitlesHidden = false }
        return true
      } catch { return false }
    },
  }
}

export function htmlPlayer(video: HTMLVideoElement, report: Report): Player {
  let generation = 0, clean = () => {}, timer: ReturnType<typeof setTimeout> | undefined
  const close = () => { generation++; clearTimeout(timer); clean(); video.pause(); video.removeAttribute('src'); video.load() }
  const fail = () => { close(); report('error', PLAYBACK_ERROR) }
  const start = (token: number) => { video.play()?.catch(() => { if (token === generation) fail() }) }
  return {
    play(url, position = 0) {
      close()
      const token = generation
      const handlers: Record<string, () => void> = {
        loadedmetadata: () => { if (position > 0 && Number.isFinite(video.duration) && video.duration > position + 1) { try { video.currentTime = position; position = 0 } catch { /* Continue from the start if seeking is unavailable. */ } } },
        playing: () => { clearTimeout(timer); report('playing') }, pause: () => { clearTimeout(timer); report('paused') },
        waiting: () => { clearTimeout(timer); timer = setTimeout(() => { if (token === generation) fail() }, 60000); report('buffering') },
        ended: () => { close(); report('ended') }, error: fail,
      }
      const guarded = Object.entries(handlers).map(([event, handler]) => {
        const fn = () => { if (token === generation) handler() }
        video.addEventListener(event, fn); return () => video.removeEventListener(event, fn)
      })
      clean = () => guarded.forEach(fn => fn())
      try { if (typeof url !== 'string' && url.playback) throw new Error('Use an adaptive or native header-capable player.'); video.src = httpUrl(typeof url === 'string' ? url : url.url); report('loading'); timer = setTimeout(() => { if (token === generation) fail() }, 30000); start(token) }
      catch { fail() }
    },
    pause() { video.pause() }, resume() { if (video.hasAttribute('src')) start(generation) },
    seek(delta) {
      if (!Number.isFinite(video.duration) || video.duration <= 1) return
      try { video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta)) } catch { /* not seekable */ }
    },
    stop() { close(); report('idle') },
    timeline() { return { position: video.currentTime || 0, duration: video.duration || 0 } },
    tracks() { return htmlTracks(video).tracks },
    selectTrack(kind, id) {
      const { audio, subtitles } = htmlTracks(video)
      if (kind === 'audio') {
        const chosen = audio.find((_, index) => String(index) === id); if (!chosen) return false
        audio.forEach(track => { track.enabled = track === chosen }); return true
      }
      if (id !== 'off' && !subtitles.some((_, index) => String(index) === id)) return false
      subtitles.forEach((track, index) => { track.mode = String(index) === id ? 'showing' : 'disabled' }); return true
    },
  }
}
type AudioTrack = { label: string; language: string; enabled: boolean }
function htmlTracks(video: HTMLVideoElement) {
  const audio = Array.from((video as HTMLVideoElement & { audioTracks?: ArrayLike<AudioTrack> }).audioTracks || [])
  const subtitles = Array.from(video.textTracks || []).filter(track => ['subtitles', 'captions'].includes(track.kind))
  const tracks: PlayerTrack[] = [
    ...audio.map((track, index) => ({ id: String(index), kind: 'audio' as const, language: track.language, label: (track.label || track.language || `Audio ${index + 1}`).slice(0, 120), active: track.enabled })),
    ...subtitles.map((track, index) => ({ id: String(index), kind: 'subtitle' as const, language: track.language, label: (track.label || track.language || `Subtitles ${index + 1}`).slice(0, 120), active: track.mode === 'showing' })),
  ]
  return { audio, subtitles, tracks }
}

import { httpUrl } from './catalog'
export type State = 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error' | 'idle'
export type Report = (state: State, detail?: string) => void
export interface Player { play(url: string, position?: number): void; pause(): void; resume(): void; seek(delta: number): void; stop(): void; timeline(): { position: number; duration: number } }
export interface AVPlay {
  open(url: string): void; close(): void; stop(): void; play(): void; pause(): void
  getState(): string; getDuration(): number; getCurrentTime(): number
  setDisplayRect(x: number, y: number, width: number, height: number): void
  setDisplayMethod(method: string): void
  setListener(listener: Record<string, (...args: any[]) => void>): void
  prepareAsync(success: () => void, failure: () => void): void
  seekTo(milliseconds: number, success: () => void, failure: () => void): void
}
const PLAYBACK_ERROR = 'This stream could not play. Check your network and provider access, then retry. Supported formats depend on the TV; DRM and custom stream headers need additional platform support.'

export function samsungPlayer(api: AVPlay, report: Report): Player {
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, seeking = false
  const close = () => {
    generation++; seeking = false; clearTimeout(timer)
    try { if (['READY', 'PLAYING', 'PAUSED'].includes(api.getState())) api.stop() } catch { /* close still releases the decoder */ }
    try { api.close() } catch { /* NONE is already closed */ }
  }
  const fail = () => { close(); report('error', PLAYBACK_ERROR) }
  return {
    play(url, position = 0) {
      close()
      const token = generation
      try {
        api.open(httpUrl(url)); api.setDisplayRect(0, 0, 1920, 1080)
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
    timeline() {
      try { return { position: api.getCurrentTime() / 1000, duration: api.getDuration() / 1000 } }
      catch { return { position: 0, duration: 0 } }
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
      try { video.src = httpUrl(url); report('loading'); timer = setTimeout(() => { if (token === generation) fail() }, 30000); start(token) }
      catch { fail() }
    },
    pause() { video.pause() }, resume() { if (video.hasAttribute('src')) start(generation) },
    seek(delta) {
      if (!Number.isFinite(video.duration) || video.duration <= 1) return
      try { video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta)) } catch { /* not seekable */ }
    },
    stop() { close(); report('idle') },
    timeline() { return { position: video.currentTime || 0, duration: video.duration || 0 } },
  }
}

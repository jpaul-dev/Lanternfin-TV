import type Mpegts from 'mpegts.js'
import { browserHeaderProblem, webAddress, type Media } from './media'
import type { Player, Report } from './player'

type Runtime = typeof Mpegts
let runtime: Promise<Runtime> | undefined
export function loadTransportRuntime(): Promise<Runtime> {
  if (!runtime) runtime = new Promise<Runtime>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'mpegts.js'
    script.onload = () => { const value = (window as Window & { mpegts?: Runtime }).mpegts; value ? resolve(value) : reject(new Error('Transport player unavailable.')) }
    script.onerror = () => reject(new Error('Transport player could not be loaded.'))
    document.head.append(script)
  }).catch(error => { runtime = undefined; throw error })
  return runtime
}
export function transportType(media: Media): 'mpegts' | 'm2ts' | 'flv' | undefined {
  try {
    const format = media.playback?.manifestType || new URL(media.url).pathname.split('.').pop()?.toLowerCase()
    return format === 'ts' || format === 'mpegts' ? 'mpegts' : format === 'm2ts' || format === 'flv' ? format : undefined
  } catch { return }
}
const ERROR = 'This transport stream could not play. Check provider access, cross-origin permissions and the TV’s codec support. Try an HLS version if available.'
/** Transmuxes unencrypted TS/FLV into MSE. It does not decode unsupported codecs or bypass DRM. */
export function transportPlayer(video: HTMLVideoElement, report: Report, getRuntime = loadTransportRuntime): Player {
  let generation = 0, engine: Mpegts.Player | undefined, cleanup = () => {}, timer: ReturnType<typeof setTimeout> | undefined
  let live = false
  const close = () => {
    generation++; clearTimeout(timer); cleanup(); cleanup = () => {}
    const old = engine; engine = undefined
    // Teardown steps are independent: even a failed unload must release the element and worker.
    if (old) { try { old.unload() } catch {}; try { old.detachMediaElement() } catch {}; try { old.destroy() } catch {} }
    video.pause()
  }
  const fail = (token: number, message = ERROR) => { if (token === generation) { close(); report('error', message) } }
  return {
    play(input, position = 0) {
      close(); const token = generation, media = typeof input === 'string' ? { url: input } : input
      const problem = media.playback?.problem || (media.playback?.drm ? 'Encrypted transport files require a provider-supported HLS or DASH manifest and a compatible DRM player.' : browserHeaderProblem(media.playback?.headers))
      if (problem) { report('error', problem); return }
      let url: string, type: ReturnType<typeof transportType>
      try { url = webAddress(media.url); type = transportType(media); if (!type) throw new Error() } catch { report('error', ERROR); return }
      live = media.mediaKind === 'live'
      const wait = () => { clearTimeout(timer); timer = setTimeout(() => fail(token, 'The transport stream stopped responding. Check your connection and retry.'), 60000) }
      report('loading', 'Opening transport stream…'); wait()
      void getRuntime().then(api => {
        if (token !== generation) return
        api.LoggingControl.enableAll = false // Library logs can otherwise include credential-bearing URLs.
        const features = api.getFeatureList()
        if (!features.msePlayback || live && !features.mseLivePlayback) { fail(token, 'This device does not support transport streams through MSE. Try your provider’s HLS format or the TV’s native player.'); return }
        const current = api.createPlayer({ type, url, isLive: live, cors: true, withCredentials: false }, {
          enableWorker: true, enableWorkerForMSE: false, enableStashBuffer: true, stashInitialSize: 128 * 1024,
          autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 10,
          lazyLoad: !live, lazyLoadMaxDuration: 45, lazyLoadRecoverDuration: 15,
          referrerPolicy: 'no-referrer', ...(media.playback?.headers ? { headers: { ...media.playback.headers } } : {}),
        })
        engine = current
        current.on(api.Events.ERROR, () => fail(token))
        const events: Record<string, () => void> = {
          loadedmetadata: () => { if (position > 0 && !live && Number.isFinite(video.duration) && video.duration > position + 1) { try { current.currentTime = position; position = 0 } catch {} } },
          playing: () => { clearTimeout(timer); report('playing') }, pause: () => { clearTimeout(timer); report('paused') },
          waiting: () => { wait(); report('buffering') }, ended: () => { close(); report('ended') }, error: () => fail(token),
        }
        const guarded = Object.entries(events).map(([name, fn]) => { const handler = () => { if (token === generation) fn() }; video.addEventListener(name, handler); return () => video.removeEventListener(name, handler) })
        cleanup = () => guarded.forEach(fn => fn())
        current.attachMediaElement(video)
        if (token !== generation) return
        current.load()
        if (token === generation) void current.play()?.catch(() => fail(token))
      }).catch(() => fail(token))
    },
    stop() { close(); report('idle') },
    pause() { try { engine?.pause() } catch { fail(generation) } },
    resume() { const token = generation; try { void engine?.play()?.catch(() => fail(token)) } catch { fail(token) } },
    seek(delta) { if (engine && !live && Number.isFinite(video.duration) && video.duration > 1) try { engine.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta)) } catch {} },
    timeline() { return { position: video.currentTime || 0, duration: live ? 0 : video.duration || 0 } },
  }
}

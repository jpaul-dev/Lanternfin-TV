import { htmlPlayer, samsungPlayer, type AVPlay, type Player, type Report } from './player'
import { browserHeaderProblem, needsAdaptivePlayer, type Media } from './media'
import { wrapLicense, unwrapLicense } from './license-format'
import { transportPlayer, transportType, loadTransportRuntime } from './transport-player'

type Request = { headers: Record<string, string>; body?: ArrayBuffer | ArrayBufferView | string | null }
type AdaptiveTrack = { id?: number; active: boolean; language: string; label?: string; roles?: string[]; channelsCount?: number; codecs?: string; spatialAudio?: boolean }
type VideoTrack = { active: boolean; width?: number; height?: number; bandwidth?: number; frameRate?: number; codecs?: string; hdr?: string; language?: string; label?: string; roles?: string[]; pixelAspectRatio?: string; colorGamut?: string; videoLayout?: string; mimeType?: string }
const videoKey = (track: VideoTrack) => JSON.stringify([track.width, track.height, track.bandwidth, track.frameRate, track.codecs, track.hdr, track.language, track.label, track.roles, track.pixelAspectRatio, track.colorGamut, track.videoLayout, track.mimeType])
const audioKey = (track: AdaptiveTrack) => JSON.stringify([track.language, track.label, track.roles, track.channelsCount, track.codecs, track.spatialAudio])
const trackLabel = (track: AdaptiveTrack) => [track.label || track.language || 'Unknown language', track.channelsCount ? `${track.channelsCount} ch` : '', track.roles?.filter(role => role !== 'main').join(', ')].filter(Boolean).join(' · ').slice(0, 160)
type Engine = {
  attach(video: HTMLVideoElement): Promise<void>; load(url: string, position?: number, mime?: string): Promise<void>; destroy(): Promise<void>
  configure(config: object): boolean; addEventListener(name: string, callback: (event: any) => void): void
  getNetworkingEngine(): { registerRequestFilter(filter: (type: number, request: Request) => void): void; registerResponseFilter?(filter: (type: number, response: { data: ArrayBuffer | ArrayBufferView | string }) => void): void }
  getAudioTracks?(): AdaptiveTrack[]; getTextTracks?(): AdaptiveTrack[]
  selectAudioTrack?(track: AdaptiveTrack, safeMargin?: number): void; selectTextTrack?(track: AdaptiveTrack | null): void
  getVideoTracks?(): VideoTrack[]; selectVideoTrack?(track: VideoTrack, clearBuffer?: boolean, safeMargin?: number): void
}
type Shaka = { Player: { new(): Engine; isBrowserSupported(): boolean }; polyfill: { installAll(): void }; net: { NetworkingEngine: { RequestType: { LICENSE: number; MANIFEST: number; SEGMENT: number; KEY?: number } } } }
let runtime: Promise<Shaka> | undefined
function loadRuntime(): Promise<Shaka> {
  if (!runtime) runtime = new Promise<Shaka>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'shaka-player.compiled.js'
    script.onload = () => { const shaka = (window as Window & { shaka?: Shaka }).shaka; shaka ? resolve(shaka) : reject(new Error('Player engine unavailable.')) }
    script.onerror = () => reject(new Error('Player engine could not be loaded. Reinstall the complete app package.'))
    document.head.append(script)
  }).catch(error => { runtime = undefined; throw error })
  return runtime
}
export function playbackError(error: { category?: number; code?: number }): string {
  const code = Number.isInteger(error.code) ? ` (code ${error.code})` : ''
  if (error.category === 6) return `DRM license or device support failed${code}. LG's simulator cannot play DRM; a physical TV with the required DRM system and provider access is needed.`
  if (error.category === 1) return `The media or license server could not be reached${code}. Check provider access, network, and cross-origin permissions.`
  if (error.category === 3 || error.category === 4) return `The stream format or codec could not be loaded${code}. Try another format from your provider.`
  return `Playback could not start${code}. Check the stream format and provider access.`
}
/** Serializes decoder teardown, so rapid zapping never destroys the next stream. */
export function adaptivePlayer(video: HTMLVideoElement, report: Report, getShaka = loadRuntime): Player & { whenStopped(): Promise<void> } {
  let generation = 0, engine: Engine | undefined, queue = Promise.resolve(), cleanup = () => {}, timer: ReturnType<typeof setTimeout> | undefined
  let automaticQuality = true
  const dispose = async () => { clearTimeout(timer); cleanup(); cleanup = () => {}; const old = engine; engine = undefined; if (old) await old.destroy().catch(() => {}) }
  const stop = () => {
    generation++
    // Destroy immediately to abort a pending load; queuing destroy behind load can deadlock.
    const closing = dispose(); video.pause()
    queue = Promise.all([queue.catch(() => {}), closing]).then(() => {})
  }
  return {
    play(input, position = 0) {
      stop(); const token = generation, media = typeof input === 'string' ? { url: input } : input
      automaticQuality = true
      const options = media.playback
      const problem = options?.problem || browserHeaderProblem(options?.headers) || browserHeaderProblem(options?.drm?.headers)
      if (problem) { report('error', problem); return }
      if (Object.keys(options?.headers || {}).length && /\.(mp4|webm|mkv|ts)(?:\?|$)/i.test(media.url)) { report('error', 'Custom media headers require an HLS or DASH manifest with this engine. Use an adaptive URL from your provider.'); return }
      report('loading', 'Opening with Shaka Player…')
      queue = queue.then(async () => {
        if (token !== generation) return
        const fail = (message: string) => { if (token === generation) { stop(); report('error', message) } }
        try {
          const shaka = await getShaka()
          if (token !== generation) return
          shaka.polyfill.installAll()
          if (!shaka.Player.isBrowserSupported()) { fail('This device does not expose the media APIs needed by Shaka Player. Try a supported physical TV.'); return }
          const current = new shaka.Player(); engine = current
          current.addEventListener('error', event => { if (event.detail?.severity === 2) fail(playbackError(event.detail)) })
          await current.attach(video)
          if (token !== generation) return
          const drm = options?.drm
          if (drm && !['com.widevine.alpha', 'com.microsoft.playready', 'org.w3.clearkey'].includes(drm.system)) { fail('This DRM system is not supported by the TV port.'); return }
          if (drm && !navigator.requestMediaKeySystemAccess) { fail('DRM is unavailable in this environment. LG’s simulator does not support DRM; test this stream on a physical TV.'); return }
          current.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 2, preferNativeHls: false }, ...(drm ? { drm: { ...(drm.licenseUrl ? { servers: { [drm.system]: drm.licenseUrl } } : {}), ...(drm.clearKeys ? { clearKeys: drm.clearKeys } : {}) } } : {}) })
          const types = shaka.net.NetworkingEngine.RequestType
          const network = current.getNetworkingEngine()
          network.registerRequestFilter((type, request) => {
            // Never send media authorization headers to a license server or vice versa.
            const values = type === types.LICENSE ? drm?.headers : type === types.MANIFEST || type === types.SEGMENT || type === types.KEY ? options?.headers : undefined
            if (values) Object.assign(request.headers, values)
            if (type === types.LICENSE && drm?.format?.request) request.body = wrapLicense(request.body, drm.format.request)
          })
          if (drm?.format?.response) {
            if (!network.registerResponseFilter) { fail('This player cannot process the provider license response format.'); return }
            network.registerResponseFilter((type, response) => { if (type === types.LICENSE) response.data = unwrapLicense(response.data, drm.format!.response!) })
          }
          const wait = () => { clearTimeout(timer); timer = setTimeout(() => fail('The stream stopped responding. Check your connection and retry.'), 60000) }
          const events: Record<string, () => void> = {
            playing: () => { clearTimeout(timer); report('playing') }, pause: () => { clearTimeout(timer); report('paused') },
            waiting: () => { wait(); report('buffering') }, ended: () => { stop(); report('ended') },
          }
          for (const [name, fn] of Object.entries(events)) video.addEventListener(name, fn)
          cleanup = () => { for (const [name, fn] of Object.entries(events)) video.removeEventListener(name, fn) }
          wait()
          const mime = options?.manifestType === 'mpd' || options?.manifestType === 'dash' ? 'application/dash+xml' : options?.manifestType === 'hls' ? 'application/x-mpegurl' : undefined
          await current.load(media.url, position || undefined, mime)
          if (token === generation) await video.play()
        } catch (error) { fail(playbackError(error as { category?: number; code?: number })) }
      })
    },
    stop() { stop(); report('idle') }, pause() { video.pause() }, resume() { const token = generation; void video.play().catch(() => { if (token === generation) report('error', 'Playback could not resume. Choose Retry stream.') }) },
    seek(delta) { if (Number.isFinite(video.duration) && video.duration > 1) try { video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + delta)) } catch { /* not seekable */ } },
    timeline() { return { position: video.currentTime || 0, duration: video.duration || 0 } },
    whenStopped() { return queue },
    qualities() {
      try {
        const tracks = engine?.getVideoTracks?.() || []
        if (!tracks.length || !engine?.selectVideoTrack) return []
        return [{ id: 'auto', label: 'Automatic', active: automaticQuality }, ...tracks.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0)).map(track => ({ id: videoKey(track), label: [track.height ? `${track.height}p` : 'Video', track.frameRate ? `${Math.round(track.frameRate)} fps` : '', track.bandwidth ? `${(track.bandwidth / 1000000).toFixed(1)} Mbps` : '', track.hdr && track.hdr !== 'SDR' ? track.hdr : ''].filter(Boolean).join(' · '), active: !automaticQuality && track.active }))]
      } catch { return [] }
    },
    selectQuality(id) {
      try {
        if (!engine?.selectVideoTrack) return false
        const track = engine.getVideoTracks?.().find(item => videoKey(item) === id)
        if (id !== 'auto' && !track) return false
        if (!engine.configure({ abr: { enabled: id === 'auto' } })) return false
        automaticQuality = id === 'auto'
        if (track) engine.selectVideoTrack(track, true, 4)
        return true
      } catch { return false }
    },
    tracks() {
      try {
        return [
          ...(engine?.getAudioTracks?.() || []).map(track => ({ id: audioKey(track), kind: 'audio' as const, language: track.language, label: trackLabel(track), active: track.active })),
          ...(engine?.getTextTracks?.() || []).map(track => ({ id: String(track.id), kind: 'subtitle' as const, language: track.language, label: trackLabel(track), active: track.active })),
        ]
      } catch { return [] }
    },
    selectTrack(kind, id) {
      try {
        if (kind === 'audio') {
          const track = engine?.getAudioTracks?.().find(track => audioKey(track) === id)
          if (!track || !engine?.selectAudioTrack) return false
          engine.selectAudioTrack(track, 2); return true
        }
        if (!engine?.selectTextTrack) return false
        const track = engine.getTextTracks?.().find(track => String(track.id) === id)
        if (id !== 'off' && !track) return false
        engine.selectTextTrack(track || null); return true
      } catch { return false }
    },
  }
}
export function canUseNativeHls(media: Media, video: HTMLVideoElement): boolean {
  return !media.playback?.drm && !media.playback?.problem && !Object.keys(media.playback?.headers || {}).length &&
    (/\.m3u8(?:\?|$)/i.test(media.url) || media.playback?.manifestType === 'hls') && !!video.canPlayType('application/vnd.apple.mpegurl')
}
export function tvPlayer(video: HTMLVideoElement, report: Report, native?: { api: AVPlay; surface: HTMLElement }, getShaka = loadRuntime, getTransport = loadTransportRuntime): Player {
  const html = htmlPlayer(video, report), samsung = native && samsungPlayer(native.api, report)
  const transport = transportPlayer(video, report, getTransport)
  let current: Player = html, generation = 0, mediaForFallback: Media | undefined, fallbackPosition = 0
  let live = false
  const adaptive = adaptivePlayer(video, (state, detail) => {
    if (state === 'error' && current === adaptive && mediaForFallback && canUseNativeHls(mediaForFallback, video)) {
      const media = mediaForFallback, position = fallbackPosition, token = generation
      mediaForFallback = undefined; adaptive.stop()
      report('loading', 'Trying the TV’s native HLS player…')
      void adaptive.whenStopped().then(() => { if (token === generation) { current = html; html.play(media.url, position) } })
    } else report(state, detail)
  }, getShaka)
  return {
    play(input, position) {
      current.stop()
      const token = ++generation, previous = current
      const media: Media = typeof input === 'string' ? { url: input } : input
      live = media.mediaKind === 'live'
      try { video.playbackRate = 1 } catch { /* Fixed-speed devices can still play normally. */ }
      video.style.objectFit = 'contain'
      mediaForFallback = media; fallbackPosition = position || 0
      const nativeHeaders = Object.keys(media.playback?.headers || {}).every(name => ['user-agent', 'cookie'].includes(name.toLowerCase()))
      const useNative = !!samsung && !media.playback?.drm && !media.playback?.problem && nativeHeaders
      const begin = () => {
        if (token !== generation) return
        current = useNative ? samsung! : transportType(media) ? transport : needsAdaptivePlayer(media) ? adaptive : html
        video.hidden = useNative; if (native) native.surface.hidden = !useNative
        current.play(media, position)
      }
      if (previous === adaptive) void adaptive.whenStopped().then(begin); else begin()
    },
    stop() { generation++; current.stop() }, pause() { current.pause() }, resume() { current.resume() }, seek(delta) { current.seek(delta) }, timeline() { return current.timeline() },
    tracks() { return current.tracks?.() || [] }, selectTrack(kind, id) { return current.selectTrack?.(kind, id) || false },
    qualities() { return current.qualities?.() || [] }, selectQuality(id) { return current.selectQuality?.(id) || false },
    speeds() { return current === samsung ? samsung.speeds!() : !live && Number.isFinite(video.duration) && video.duration > 1 ? [.5, .75, 1, 1.25, 1.5, 2] : [] },
    speed() { return current === samsung ? samsung.speed!() : video.playbackRate || 1 },
    setSpeed(rate) { if (current === samsung) return samsung.setSpeed!(rate); if (!this.speeds?.().includes(rate)) return false; try { video.playbackRate = rate; return video.playbackRate === rate } catch { return false } },
    aspects() { return current === samsung ? samsung.aspects!() : ['fit', 'zoom', 'stretch'] },
    setAspect(aspect) { if (current === samsung) return samsung.setAspect!(aspect); if (!['fit', 'zoom', 'stretch'].includes(aspect)) return false; video.style.objectFit = aspect === 'fit' ? 'contain' : aspect === 'zoom' ? 'cover' : 'fill'; return true },
  }
}

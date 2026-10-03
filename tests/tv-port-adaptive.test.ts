// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { adaptivePlayer, canUseNativeHls, playbackError, tvPlayer } from '../tv-app/adaptive-player'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function harness(pending = false) {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  let filter: (type: number, request: { headers: Record<string, string> }) => void = () => {}
  let rejectLoad: (error: object) => void = () => {}
  const engine = { attach: vi.fn().mockResolvedValue(undefined), load: vi.fn(() => pending ? new Promise<void>((_, reject) => { rejectLoad = reject }) : Promise.resolve()), destroy: vi.fn(async () => { rejectLoad({ code: 7000 }) }), configure: vi.fn(() => true), addEventListener: vi.fn(), getNetworkingEngine: () => ({ registerRequestFilter: (fn: typeof filter) => { filter = fn } }) }
  const Constructor = Object.assign(function () { return engine }, { isBrowserSupported: () => true })
  const runtime = { Player: Constructor, polyfill: { installAll() {} }, net: { NetworkingEngine: { RequestType: { LICENSE: 2, MANIFEST: 0, SEGMENT: 1, KEY: 6 } } } }
  const report = vi.fn(), player = adaptivePlayer(document.createElement('video'), report, async () => runtime as any)
  return { engine, player, report, runtime, apply: (type: number) => { const request = { headers: {} }; filter(type, request); return request.headers } }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
it('uses the UI text renderer for bounded live subtitle adjustments and resets them between streams', async () => {
  vi.useFakeTimers(); const h = harness(), surface = document.createElement('div'), video = document.createElement('video'); surface.append(video); document.body.append(surface)
  const container = vi.fn(), text = vi.fn(() => [{ id: 1, active: true, language: 'en', label: 'stream_0' }])
  Object.assign(h.engine, { setVideoContainer: container, getTextTracks: text })
  const player = tvPlayer(video, h.report, undefined, async () => h.runtime as any)
  player.play('https://example.com/captions.mpd'); await settle()
  expect(container).toHaveBeenCalledWith(surface); expect(player.subtitlePresentation?.()).toEqual({ delay: 0, scale: 1 })
  expect(player.tracks?.()[0].label).toContain('English')
  expect(player.setSubtitlePresentation?.({ delay: -1.5, scale: 1.5 })).toBe(true)
  expect(h.engine.configure).toHaveBeenLastCalledWith({ textDisplayer: { subtitleDelay: -1.5, fontScaleFactor: 1.5 } })
  for (const value of [{ delay: NaN, scale: 1 }, { delay: 6, scale: 1 }, { delay: 0, scale: 100 }]) expect(player.setSubtitlePresentation?.(value)).toBe(false)
  h.engine.configure.mockReturnValueOnce(false); expect(player.setSubtitlePresentation?.({ delay: 2, scale: 2 })).toBe(false)
  expect(player.subtitlePresentation?.()).toEqual({ delay: -1.5, scale: 1.5 })
  text.mockReturnValueOnce([]); expect(player.subtitlePresentation?.()).toBeUndefined()
  player.play('https://example.com/second.mpd'); await settle(); await settle()
  expect(player.subtitlePresentation?.()).toEqual({ delay: 0, scale: 1 })
  player.stop(); await settle(); expect(player.subtitlePresentation?.()).toBeUndefined(); surface.remove(); vi.clearAllTimers()
})
it('does not advertise subtitle adjustments without a text renderer and subtitle tracks', async () => {
  vi.useFakeTimers(); const h = harness()
  Object.assign(h.engine, { getTextTracks: () => [{ id: 1, active: true, language: 'en' }] })
  h.player.play('https://example.com/captions.mpd'); await settle()
  expect(h.player.subtitlePresentation?.()).toBeUndefined()
  expect(h.player.setSubtitlePresentation?.({ delay: 1, scale: 1 })).toBe(false)
  h.player.stop(); await settle(); vi.clearAllTimers()
})
it('isolates media headers from license requests and installs the explicit DRM configuration', async () => {
  vi.useFakeTimers(); vi.stubGlobal('navigator', { requestMediaKeySystemAccess: vi.fn() })
  const h = harness()
  h.player.play({ url: 'https://example.com/a.mpd', playback: { headers: { Authorization: 'media' }, drm: { system: 'com.widevine.alpha', licenseUrl: 'https://license.example/', headers: { Authorization: 'license' } } } }); await settle()
  expect(h.engine.configure).toHaveBeenCalledWith(expect.objectContaining({ drm: { servers: { 'com.widevine.alpha': 'https://license.example/' } } }))
  expect(h.apply(0)).toEqual({ Authorization: 'media' }); expect(h.apply(2)).toEqual({ Authorization: 'license' })
  h.player.stop(); await settle(); vi.clearAllTimers()
})
it('filters headers by request purpose, preserving media authentication only on media', async () => {
  vi.useFakeTimers(); const h = harness()
  h.player.play({ url: 'https://example.com/a.mpd', playback: { headers: { Authorization: 'media' } } })
  await settle()
  expect(h.apply(0)).toEqual({ Authorization: 'media' }); expect(h.apply(1)).toEqual({ Authorization: 'media' }); expect(h.apply(6)).toEqual({ Authorization: 'media' }); expect(h.apply(2)).toEqual({}); expect(h.apply(5)).toEqual({})
  h.player.stop(); await settle(); vi.clearAllTimers()
})
it('destroys a pending load on stop without waiting for that load to finish', async () => {
  vi.useFakeTimers(); const h = harness(true)
  h.player.play('https://example.com/first.mpd'); await settle(); expect(h.engine.load).toHaveBeenCalledOnce()
  h.player.stop(); await settle(); expect(h.engine.destroy).toHaveBeenCalledOnce()
  expect(h.report.mock.calls.at(-1)).toEqual(['idle']); vi.clearAllTimers()
})
it('fails before loading when a required header cannot be honored', async () => {
  const h = harness(); h.player.play({ url: 'https://example.com/a.mpd', playback: { headers: { referer: 'secret' } } }); await settle()
  expect(h.engine.load).not.toHaveBeenCalled(); expect(h.report.mock.calls.at(-1)?.[1]).toContain('referer'); expect(h.report.mock.calls.at(-1)?.[1]).not.toContain('secret')
})
it('separates DRM errors from network and format errors', () => {
  expect(playbackError({ category: 6, code: 6001 })).toContain('simulator')
  expect(playbackError({ category: 1, code: 1001 })).toContain('network')
  expect(playbackError({ category: 3 })).not.toContain('DRM')
})
it('falls back to native HLS after a Shaka failure, after releasing Shaka', async () => {
  vi.useFakeTimers(); const h = harness(), video = document.createElement('video')
  vi.spyOn(video, 'canPlayType').mockReturnValue('probably')
  vi.spyOn(video, 'load').mockImplementation(() => {})
  h.engine.load.mockRejectedValue({ category: 1, code: 1001 })
  const player = tvPlayer(video, h.report, undefined, async () => h.runtime as any)
  player.play('https://example.com/live.m3u8'); await settle(); await settle()
  expect(h.engine.destroy).toHaveBeenCalledOnce(); expect(video.src).toBe('https://example.com/live.m3u8')
  player.stop(); vi.clearAllTimers()
})
it('never falls back by silently dropping DRM or required headers', () => {
  const video = document.createElement('video'); vi.spyOn(video, 'canPlayType').mockReturnValue('probably')
  for (const playback of [{ headers: { Authorization: 'secret' } }, { drm: { system: 'com.widevine.alpha' } }, { problem: 'Unsupported options' }]) {
    expect(canUseNativeHls({ url: 'https://example.com/live.m3u8', playback }, video)).toBe(false)
  }
})
it('selects Shaka audio by track properties and can turn subtitles off', async () => {
  vi.useFakeTimers(); const h = harness()
  const english = { active: true, language: 'en', roles: ['main'], channelsCount: 2 }, french = { active: false, language: 'fr', roles: ['main'], channelsCount: 2 }
  const caption = { active: false, language: 'en', id: 7, label: 'English captions' }
  const selectAudio = vi.fn(), selectText = vi.fn()
  Object.assign(h.engine, { getAudioTracks: () => [english, french], getTextTracks: () => [caption], selectAudioTrack: selectAudio, selectTextTrack: selectText })
  h.player.play('https://example.com/a.mpd'); await settle()
  const tracks = h.player.tracks!(); expect(tracks).toHaveLength(3)
  expect(h.player.selectTrack!('audio', tracks[1].id)).toBe(true); expect(selectAudio).toHaveBeenCalledWith(french, 2)
  expect(h.player.selectTrack!('subtitle', '7')).toBe(true); expect(selectText).toHaveBeenLastCalledWith(caption)
  expect(h.player.selectTrack!('subtitle', 'off')).toBe(true); expect(selectText).toHaveBeenLastCalledWith(null)
  expect(h.player.selectTrack!('audio', 'unknown')).toBe(false)
  h.player.stop(); await settle(); expect(h.player.tracks!()).toEqual([]); vi.clearAllTimers()
})
it('changes video quality independently from audio and restores automatic adaptation', async () => {
  vi.useFakeTimers(); const h = harness()
  const hd = { active: true, width: 1280, height: 720, bandwidth: 2200000, frameRate: 30 }, sd = { active: false, width: 640, height: 360, bandwidth: 700000, frameRate: 30 }
  const selectVideo = vi.fn(), selectAudio = vi.fn()
  Object.assign(h.engine, { getVideoTracks: () => [sd, hd], selectVideoTrack: selectVideo, selectAudioTrack: selectAudio })
  h.player.play('https://example.com/a.mpd'); await settle()
  const options = h.player.qualities!(); expect(options.map(option => option.label)).toEqual(['Automatic', '720p · 30 fps · 2.2 Mbps', '360p · 30 fps · 0.7 Mbps'])
  expect(h.player.selectQuality!(options[2].id)).toBe(true); expect(selectVideo).toHaveBeenCalledWith(sd, true, 4)
  expect(h.engine.configure).toHaveBeenLastCalledWith({ abr: { enabled: false } }); expect(selectAudio).not.toHaveBeenCalled()
  expect(h.player.selectQuality!('unknown')).toBe(false)
  expect(h.player.selectQuality!('auto')).toBe(true); expect(h.engine.configure).toHaveBeenLastCalledWith({ abr: { enabled: true } })
  h.player.stop(); await settle(); expect(h.player.qualities!()).toEqual([]); vi.clearAllTimers()
})
it('wraps only license requests and responses, keeping manifests and keys unchanged', async () => {
  vi.useFakeTimers(); vi.stubGlobal('navigator', { requestMediaKeySystemAccess: vi.fn() }); const h = harness()
  let outgoing!: (type: number, request: any) => void, incoming!: (type: number, response: any) => void
  Object.assign(h.engine, { getNetworkingEngine: () => ({ registerRequestFilter: (fn: typeof outgoing) => { outgoing = fn }, registerResponseFilter: (fn: typeof incoming) => { incoming = fn } }) })
  h.player.play({ url: 'https://example.com/a.mpd', playback: { headers: { Authorization: 'media' }, drm: { system: 'com.widevine.alpha', licenseUrl: 'https://license.example', headers: { Authorization: 'license' }, format: { request: '{"challenge":"b{SSM}"}', response: 'JBlicense' } } } }); await settle()
  const original = new Uint8Array([0, 255]), request = { headers: {}, body: original }
  outgoing(2, request); expect(request.headers).toEqual({ Authorization: 'license' }); expect(JSON.parse(new TextDecoder().decode(request.body))).toEqual({ challenge: 'AP8=' })
  const response = { data: '{"license":"AP8="}' }; incoming(2, response); expect(response.data).toEqual(original)
  const key = { headers: {}, body: original }; outgoing(6, key); expect(key.body).toBe(original); expect(key.headers).toEqual({ Authorization: 'media' })
  const manifest = { data: '<MPD/>' }; incoming(0, manifest); expect(manifest.data).toBe('<MPD/>')
  h.player.stop(); await settle(); vi.clearAllTimers()
})

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { adaptivePlayer, canUseNativeHls, playbackError, tvPlayer } from '../tv-app/adaptive-player'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function harness(pending = false) {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  let filter: (type: number, request: { headers: Record<string, string> }) => void = () => {}
  let rejectLoad: (error: object) => void = () => {}
  const engine = { attach: vi.fn().mockResolvedValue(undefined), load: vi.fn(() => pending ? new Promise<void>((_, reject) => { rejectLoad = reject }) : Promise.resolve()), destroy: vi.fn(async () => { rejectLoad({ code: 7000 }) }), configure: vi.fn(() => true), addEventListener: vi.fn(), getNetworkingEngine: () => ({ registerRequestFilter: (fn: typeof filter) => { filter = fn } }) }
  const Constructor = Object.assign(function () { return engine }, { isBrowserSupported: () => true })
  const runtime = { Player: Constructor, polyfill: { installAll() {} }, net: { NetworkingEngine: { RequestType: { LICENSE: 2, MANIFEST: 0, SEGMENT: 1 } } } }
  const report = vi.fn(), player = adaptivePlayer(document.createElement('video'), report, async () => runtime as any)
  return { engine, player, report, runtime, apply: (type: number) => { const request = { headers: {} }; filter(type, request); return request.headers } }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
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
  expect(h.apply(0)).toEqual({ Authorization: 'media' }); expect(h.apply(1)).toEqual({ Authorization: 'media' }); expect(h.apply(2)).toEqual({})
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

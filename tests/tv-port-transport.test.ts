// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { transportPlayer, transportType } from '../tv-app/transport-player'
import { tvPlayer } from '../tv-app/adaptive-player'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function harness() {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const callbacks = new Map<string, Function>()
  const engine = { attachMediaElement: vi.fn(), detachMediaElement: vi.fn(), destroy: vi.fn(), load: vi.fn(), unload: vi.fn(), play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), on: vi.fn((name, callback) => callbacks.set(name, callback)), currentTime: 0 }
  const runtime = { LoggingControl: { enableAll: true }, getFeatureList: () => ({ msePlayback: true, mseLivePlayback: true }), createPlayer: vi.fn(() => engine), Events: { ERROR: 'error' } }
  const get = vi.fn(async () => runtime as any), video = document.createElement('video'), report = vi.fn()
  const player = transportPlayer(video, report, get)
  return { engine, runtime, get, video, report, player, error: () => callbacks.get('error')?.('network', 'private URL and token') }
}
it('selects TS, M2TS and FLV without misidentifying HLS segment URLs in queries', () => {
  expect(transportType({ url: 'https://example.com/a.TS?token=private' })).toBe('mpegts')
  expect(transportType({ url: 'https://example.com/a.m3u8?file=a.ts' })).toBeUndefined()
  expect(transportType({ url: 'https://example.com/channel', playback: { manifestType: 'ts' } })).toBe('mpegts')
  expect(transportType({ url: 'invalid' })).toBeUndefined()
  expect(transportType({ url: 'https://example.com/a.m2ts' })).toBe('m2ts')
  expect(transportType({ url: 'https://example.com/a.flv' })).toBe('flv')
})
it('preserves allowed headers, disables URL logging and bounds retained video buffers', async () => {
  const h = harness()
  h.player.play({ url: 'https://example.com/live.ts', mediaKind: 'live', playback: { headers: { Authorization: 'secret' } } }); await settle()
  expect(h.runtime.createPlayer).toHaveBeenCalledWith({ type: 'mpegts', url: 'https://example.com/live.ts', isLive: true, cors: true, withCredentials: false }, expect.objectContaining({ headers: { Authorization: 'secret' }, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, referrerPolicy: 'no-referrer' }))
  expect(h.runtime.LoggingControl.enableAll).toBe(false); expect(h.engine.play).toHaveBeenCalledOnce()
  h.video.dispatchEvent(new Event('playing')); expect(h.report).toHaveBeenLastCalledWith('playing')
  Object.defineProperty(h.video, 'duration', { value: 600 }); h.player.seek(10); expect(h.engine.currentTime).toBe(0)
  h.player.stop(); expect(h.engine.destroy).toHaveBeenCalledOnce(); expect(h.player.timeline().duration).toBe(0)
  h.video.dispatchEvent(new Event('playing')); h.error(); expect(h.report).toHaveBeenLastCalledWith('idle')
})
it('rejects DRM, forbidden headers and invalid addresses before starting a request', async () => {
  const h = harness()
  for (const playback of [{ drm: { system: 'com.widevine.alpha' } }, { headers: { referer: 'private' } }, { problem: 'Unsupported configuration' }]) h.player.play({ url: 'https://example.com/a.ts', playback })
  h.player.play('file:///private.ts'); await settle()
  expect(h.get).not.toHaveBeenCalled(); expect(JSON.stringify(h.report.mock.calls)).not.toContain('private')
  h.player.stop()
})
it('cancels delayed startup, ignores stale errors and releases all resources after unload failure', async () => {
  const h = harness(); let ready!: (value: any) => void
  const player = transportPlayer(h.video, h.report, () => new Promise(resolve => { ready = resolve }))
  player.play('https://example.com/a.ts'); player.stop(); ready(h.runtime); await settle()
  expect(h.engine.load).not.toHaveBeenCalled()
  h.player.play('https://example.com/a.ts'); await settle(); h.engine.unload.mockImplementation(() => { throw new Error() })
  h.player.stop(); expect(h.engine.detachMediaElement).toHaveBeenCalledOnce(); expect(h.engine.destroy).toHaveBeenCalledOnce()
  h.error(); expect(h.report).toHaveBeenLastCalledWith('idle')
})
it('reports unsupported environments and startup stalls with no provider detail', async () => {
  const h = harness(); h.runtime.getFeatureList = () => ({ msePlayback: false, mseLivePlayback: false })
  h.player.play('https://example.com/a.ts'); await settle(); expect(h.report.mock.calls.at(-1)?.[1]).toContain('does not support')
  h.runtime.getFeatureList = () => ({ msePlayback: true, mseLivePlayback: true })
  h.player.play('https://example.com/a.ts'); await settle(); await vi.advanceTimersByTimeAsync(60000)
  expect(h.report.mock.calls.at(-1)?.[1]).toContain('stopped responding'); expect(h.engine.destroy).toHaveBeenCalledOnce()
  h.player.stop()
})
it('routes TS through the transport engine and resets VOD speed on each new stream', async () => {
  const h = harness(), shaka = vi.fn(), player = tvPlayer(h.video, h.report, undefined, shaka, h.get)
  Object.defineProperty(h.video, 'duration', { value: 600 }); player.play({ url: 'https://example.com/a.ts', mediaKind: 'movie' }); await settle()
  expect(h.engine.load).toHaveBeenCalledOnce(); expect(shaka).not.toHaveBeenCalled()
  expect(player.setSpeed!(1.5)).toBe(true); expect(player.speed!()).toBe(1.5); expect(player.setSpeed!(Infinity)).toBe(false)
  player.play({ url: 'https://example.com/live.ts', mediaKind: 'live' }); await settle()
  expect(player.speed!()).toBe(1); expect(player.speeds!()).toEqual([]); expect(player.setSpeed!(2)).toBe(false)
  player.stop()
})

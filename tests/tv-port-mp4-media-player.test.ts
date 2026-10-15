// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mp4MediaPlayer, needsMp4Media } from '../tv-app/mp4-media-player'
import { tvPlayer } from '../tv-app/adaptive-player'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const media = { url: 'https://provider.invalid/video.mp4', playback: { headers: { Authorization: 'private' } } }
const info = { duration: 70, tracks: [{ id: 1, kind: 'video', language: 'und', mime: 'video/mp4; codecs="avc1.64000c"' }, { id: 2, kind: 'audio', language: 'eng', mime: 'audio/mp4; codecs="mp4a.40.2"' }, { id: 3, kind: 'audio', language: 'fra', mime: 'audio/mp4; codecs="mp4a.40.2"' }] }
function harness() {
  vi.useFakeTimers()
  const video = document.createElement('video'), report = vi.fn(), requests: any[] = [], workers: FakeWorker[] = [], sources: FakeSource[] = []
  let selected = [1, 2], delayed: string | undefined, pending: (() => void) | undefined, end = 0, start = 0
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  Object.defineProperty(video, 'buffered', { get: () => ({ length: end > start ? 1 : 0, start: () => start, end: () => end }) })
  class FakeWorker {
    onmessage: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; terminate = vi.fn()
    constructor() { workers.push(this) }
    postMessage(message: any) {
      requests.push(message)
      const reply = () => {
        let result: any = info
        if (message.action === 'initialize') { selected = message.tracks; result = [{ id: 0, buffer: new ArrayBuffer(8) }] }
        if (message.action === 'segment') { const next = Math.min(70, message.position + 6); result = { next, done: next === 70, segments: selected.map(id => { const buffer = new ArrayBuffer(8); new Float64Array(buffer)[0] = next; return { id, buffer } }) } }
        this.onmessage?.({ data: { id: message.id, result } })
      }
      if (message.action === delayed) pending = reply; else queueMicrotask(reply)
    }
  }
  class FakeBuffer extends EventTarget {
    buffered = { get length() { return end > start ? 1 : 0 }, start: () => start, end: () => end }
    appendBuffer(buffer: ArrayBuffer) { end = Math.max(end, new Float64Array(buffer)[0]); queueMicrotask(() => this.dispatchEvent(new Event('updateend'))) }
    remove(_from: number, to: number) { start = to; if (start >= end) start = end = 0; queueMicrotask(() => this.dispatchEvent(new Event('updateend'))) }
  }
  class FakeSource extends EventTarget {
    static isTypeSupported = vi.fn(() => true)
    duration = 70; readyState = 'open'; added: string[] = []
    constructor() { super(); sources.push(this) }
    addSourceBuffer(mime: string) { if (this.added.length) throw new Error('Only one multiplexed source buffer is supported'); this.added.push(mime); return new FakeBuffer() }
    endOfStream() { this.readyState = 'ended' }
  }
  vi.stubGlobal('MediaSource', FakeSource)
  const revoke = vi.fn(); const originalURL = URL
  vi.stubGlobal('URL', class extends originalURL { static createObjectURL(source: FakeSource) { queueMicrotask(() => source.dispatchEvent(new Event('sourceopen'))); return 'blob:test' }; static revokeObjectURL = revoke })
  vi.stubGlobal('Worker', FakeWorker)
  const player = mp4MediaPlayer(video, report, () => new FakeWorker() as any)
  return { player, video, report, play, workers, sources, requests, revoke, supported: FakeSource.isTypeSupported, hold(action: string) { delayed = action }, release() { delayed = undefined; pending?.(); pending = undefined } }
}
it('loads buffered MP4, bounds read-ahead, pauses, seeks and switches audio at the current position', async () => {
  const h = harness(); h.player.play(media); await vi.advanceTimersByTimeAsync(2000)
  expect(h.play).toHaveBeenCalledOnce(); expect(h.requests.filter(r => r.action === 'segment')).toHaveLength(3)
  expect(h.player.tracks?.().map(t => t.language)).toEqual(['eng', 'fra'])
  expect(h.player.selectTrack?.('subtitle', 'off')).toBe(true); expect(h.player.selectTrack?.('subtitle', '2')).toBe(false)
  h.player.pause(); h.player.seek(40); await vi.advanceTimersByTimeAsync(1000)
  expect(h.requests).toContainEqual(expect.objectContaining({ action: 'segment', position: 40, reset: true }))
  expect(h.video.currentTime).toBe(40); expect(h.play).toHaveBeenCalledOnce()
  expect(h.report).toHaveBeenLastCalledWith('paused')
  expect(h.player.selectTrack?.('audio', '3')).toBe(true); await vi.advanceTimersByTimeAsync(1000)
  expect(h.workers[0].terminate).toHaveBeenCalledOnce(); expect(h.requests).toContainEqual(expect.objectContaining({ action: 'initialize', tracks: [1, 3] }))
  expect(h.video.currentTime).toBe(40); expect(h.play).toHaveBeenCalledOnce()
  h.player.resume(); await vi.advanceTimersByTimeAsync(0); expect(h.play).toHaveBeenCalledTimes(2)
  h.player.stop(); expect(h.revoke).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
})
it('keeps the last rapid seek and ignores a stopped reader’s delayed result', async () => {
  const h = harness(); h.player.play(media); await vi.advanceTimersByTimeAsync(1000)
  h.hold('segment'); h.player.seek(20); await vi.advanceTimersByTimeAsync(0); h.player.seek(10); h.player.seek(10)
  h.release(); await vi.advanceTimersByTimeAsync(1000)
  expect(h.video.currentTime).toBe(40)
  h.hold('segment'); h.player.seek(-30); await vi.advanceTimersByTimeAsync(0)
  h.player.stop(); const count = h.report.mock.calls.length; h.release(); await vi.advanceTimersByTimeAsync(1000)
  expect(h.report.mock.calls).toHaveLength(count); expect(h.report).toHaveBeenLastCalledWith('idle'); expect(vi.getTimerCount()).toBe(0)
})
it('stops a stuck worker, rejects browser-controlled headers and checks codec support before attaching', async () => {
  const h = harness(); h.hold('open'); h.player.play(media); await vi.advanceTimersByTimeAsync(45000)
  expect(h.report).toHaveBeenLastCalledWith('error', expect.stringContaining('stopped responding')); expect(h.workers[0].terminate).toHaveBeenCalledOnce()
  h.player.play({ ...media, playback: { headers: { 'user-agent': 'private' } } }); expect(h.workers).toHaveLength(1)
  h.release(); h.supported.mockReturnValue(false); h.player.play(media); await vi.advanceTimersByTimeAsync(0)
  expect(h.report).toHaveBeenLastCalledWith('error', expect.stringContaining('codec')); expect(h.sources).toHaveLength(0)
  h.player.stop(); expect(JSON.stringify(h.report.mock.calls)).not.toContain('private')
})
it('routes only header-bearing progressive MP4, preserving native and adaptive paths', async () => {
  expect(needsMp4Media(media)).toBe(true)
  expect(needsMp4Media({ ...media, url: 'https://example.test/watch', playback: { ...media.playback, manifestType: 'mp4' } })).toBe(true)
  for (const other of [{ url: 'https://example.invalid/a.mp4' }, { ...media, mediaKind: 'live' }, { ...media, playback: { ...media.playback, manifestType: 'hls' } }, { ...media, playback: { ...media.playback, drm: { system: 'com.widevine.alpha' } } }, { ...media, url: 'https://example.invalid/a.m3u8?file=a.mp4' }]) expect(needsMp4Media(other as any)).toBe(false)
  const h = harness(), shaka = vi.fn(), player = tvPlayer(h.video, h.report, undefined, shaka)
  player.play(media); await vi.advanceTimersByTimeAsync(1000)
  expect(h.workers).toHaveLength(1); expect(shaka).not.toHaveBeenCalled(); expect(player.diagnostics?.().engine).toBe('mp4')
  player.stop(); expect(vi.getTimerCount()).toBe(0)
})
it('detects an extensionless MP4 with its media headers before starting the bounded worker', async () => {
  const h = harness(), shaka = vi.fn(), player = tvPlayer(h.video, h.report, undefined, shaka)
  const fetch = vi.fn(async () => new Response(null, { headers: { 'Content-Type': 'video/mp4' } })); vi.stubGlobal('fetch', fetch)
  player.play({ ...media, url: 'https://example.test/watch?id=7' }, 18); await vi.advanceTimersByTimeAsync(1000)
  expect(fetch).toHaveBeenCalledOnce(); expect(h.workers).toHaveLength(1); expect(shaka).not.toHaveBeenCalled()
  expect(h.requests[0]).toMatchObject({ action: 'open', media: { url: 'https://example.test/watch?id=7', playback: { headers: { Authorization: 'private' }, manifestType: 'mp4' } } })
  expect(h.requests.find(item => item.action === 'segment')).toMatchObject({ position: 18 })
  player.stop(); expect(vi.getTimerCount()).toBe(0)
})
it('cancels format detection on Stop and rapid source changes without accepting late responses', async () => {
  const h = harness(), shaka = vi.fn(), player = tvPlayer(h.video, h.report, undefined, shaka)
  const pending: Array<{ signal: AbortSignal; resolve(response: Response): void }> = []
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise<Response>(resolve => pending.push({ signal: init.signal, resolve }))))
  player.play({ ...media, url: 'https://example.test/one' }); await vi.advanceTimersByTimeAsync(0)
  player.play({ ...media, url: 'https://example.test/two' }); await vi.advanceTimersByTimeAsync(0)
  expect(pending[0].signal.aborted).toBe(true); player.stop(); expect(pending[1].signal.aborted).toBe(true)
  for (const item of pending) item.resolve(new Response(null, { headers: { 'Content-Type': 'video/mp4' } }))
  await vi.advanceTimersByTimeAsync(500)
  expect(h.workers).toHaveLength(0); expect(shaka).not.toHaveBeenCalled(); expect(h.report).toHaveBeenLastCalledWith('idle'); expect(vi.getTimerCount()).toBe(0)
})

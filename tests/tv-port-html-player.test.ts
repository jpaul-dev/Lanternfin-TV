// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { htmlPlayer } from '../tv-app/player'
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
it('releases the video source and pending timeout on stop', () => {
  vi.useFakeTimers()
  const video = document.createElement('video'), report = vi.fn(), player = htmlPlayer(video, report)
  player.play('https://example.com/video.mp4'); expect(video.src).toBe('https://example.com/video.mp4')
  player.stop(); expect(video.hasAttribute('src')).toBe(false)
  vi.advanceTimersByTime(30000); expect(report).toHaveBeenLastCalledWith('idle')
})
it('does not interrupt a new stream when an old play promise rejects', async () => {
  let rejectOld!: (reason: Error) => void
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject }))
  const video = document.createElement('video'), report = vi.fn(), player = htmlPlayer(video, report)
  player.play('https://example.com/old'); player.play('https://example.com/new')
  rejectOld(new Error('old playback failed')); await Promise.resolve()
  expect(video.src).toBe('https://example.com/new'); expect(report).not.toHaveBeenCalledWith('error', expect.anything()); player.stop()
})
it('reports media states and tears down on decode failure', () => {
  const video = document.createElement('video'), report = vi.fn(), player = htmlPlayer(video, report)
  player.play('https://example.com/video')
  video.dispatchEvent(new Event('playing')); expect(report).toHaveBeenLastCalledWith('playing')
  video.dispatchEvent(new Event('waiting')); expect(report).toHaveBeenLastCalledWith('buffering')
  video.dispatchEvent(new Event('error')); expect(video.hasAttribute('src')).toBe(false)
  expect(report).toHaveBeenLastCalledWith('error', expect.stringContaining('could not play'))
})
it('does not seek an infinite live timeline and bounds VOD seeking', () => {
  const video = document.createElement('video'), player = htmlPlayer(video, vi.fn())
  Object.defineProperty(video, 'duration', { configurable: true, value: Infinity })
  player.seek(10); expect(video.currentTime).toBe(0)
  Object.defineProperty(video, 'duration', { configurable: true, value: 50 })
  player.seek(100); expect(video.currentTime).toBe(49)
  player.seek(-100); expect(video.currentTime).toBe(0)
})

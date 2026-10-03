import { afterEach, describe, expect, it, vi } from 'vitest'
import { samsungPlayer, type AVPlay } from '../tv-app/player'
function fixture() {
  let state = 'NONE'
  const pending: Array<{ success: () => void; failure: () => void }> = []
  const listeners: Array<Record<string, (...args: any[]) => void>> = []
  const api: AVPlay = {
    open: vi.fn(() => { state = 'IDLE' }), close: vi.fn(() => { state = 'NONE' }), stop: vi.fn(() => { state = 'IDLE' }),
    play: vi.fn(() => { state = 'PLAYING' }), pause: vi.fn(() => { state = 'PAUSED' }), getState: () => state,
    getDuration: () => 100000, getCurrentTime: () => 95000, setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
    setListener: listener => { listeners.push(listener) }, prepareAsync: (success, failure) => pending.push({ success, failure }),
    seekTo: vi.fn((_time, success) => success()),
  }
  const report = vi.fn(), player = samsungPlayer(api, report)
  return { api, pending, listeners, report, player }
}
afterEach(() => vi.useRealTimers())
describe('Samsung native player lifecycle', () => {
  it('resumes a prepared movie at the saved time before starting playback', () => {
    const { api, pending, player } = fixture()
    player.play('https://example.com/movie.mp4', 30); pending[0].success()
    expect(api.seekTo).toHaveBeenCalledWith(30000, expect.any(Function), expect.any(Function))
    expect(api.play).toHaveBeenCalledOnce(); expect(player.timeline()).toEqual({ position: 95, duration: 100 }); player.stop()
  })
  it('cannot restart a stopped movie when a resume seek completes late', () => {
    const { api, pending, player } = fixture(); let finish!: () => void
    vi.mocked(api.seekTo).mockImplementation((_time, success) => { finish = success })
    player.play('https://example.com/movie.mp4', 30); pending[0].success(); player.stop(); finish()
    expect(api.play).not.toHaveBeenCalled()
  })
  it('ends a permanent Samsung buffering stall', () => {
    vi.useFakeTimers(); const { player, pending, listeners, report } = fixture()
    player.play('https://example.com/live'); pending[0].success(); listeners[0].onbufferingstart()
    vi.advanceTimersByTime(60000); expect(report).toHaveBeenLastCalledWith('error', expect.any(String))
  })
  it('prepares asynchronously before playing in the native 1920x1080 plane', () => {
    const { api, pending, player } = fixture(); player.play('https://example.com/stream')
    expect(api.play).not.toHaveBeenCalled(); expect(api.setDisplayRect).toHaveBeenCalledWith(0, 0, 1920, 1080)
    pending[0].success(); expect(api.play).toHaveBeenCalledOnce(); player.stop()
  })
  it('ignores late preparation and callbacks after switching channels', () => {
    const { api, pending, listeners, player, report } = fixture()
    player.play('https://example.com/one'); player.play('https://example.com/two')
    pending[0].success(); pending[0].failure(); listeners[0].onerror(); listeners[0].onstreamcompleted()
    expect(api.play).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalledWith('error', expect.anything())
    pending[1].success(); expect(api.play).toHaveBeenCalledOnce(); player.stop()
  })
  it('cannot restart playback after leaving the app during preparation', () => {
    const { api, pending, player } = fixture(); player.play('https://example.com/one'); player.stop(); pending[0].success()
    expect(api.play).not.toHaveBeenCalled(); expect(api.getState()).toBe('NONE')
  })
  it('releases the decoder on completion and errors', () => {
    const { api, listeners, player, pending, report } = fixture(); player.play('https://example.com/a'); pending[0].success()
    listeners[0].onstreamcompleted(); expect(api.getState()).toBe('NONE'); expect(report).toHaveBeenLastCalledWith('ended')
    player.play('https://example.com/b'); pending[1].failure(); expect(api.getState()).toBe('NONE'); expect(report).toHaveBeenLastCalledWith('error', expect.stringContaining('could not play'))
  })
  it('times out preparation, ignoring an eventual successful callback', () => {
    vi.useFakeTimers(); const { player, api, pending, report } = fixture(); player.play('https://example.com/a')
    vi.advanceTimersByTime(30000); expect(report).toHaveBeenLastCalledWith('error', expect.any(String))
    pending[0].success(); expect(api.play).not.toHaveBeenCalled()
  })
  it('only seeks VOD when ready, clamps the endpoint, and respects pause state', () => {
    const { api, pending, player } = fixture(); player.play('https://example.com/a'); player.seek(10)
    expect(api.seekTo).not.toHaveBeenCalled(); pending[0].success(); player.pause(); expect(api.getState()).toBe('PAUSED')
    player.seek(10); expect(api.seekTo).toHaveBeenCalledWith(99000, expect.any(Function), expect.any(Function))
    player.resume(); expect(api.getState()).toBe('PLAYING'); player.stop()
  })
})

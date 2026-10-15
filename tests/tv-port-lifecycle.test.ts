// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ScreenSaver, bindLifecycle } from '../tv-app/lifecycle'

afterEach(() => vi.restoreAllMocks())
it('corrects a late screensaver OFF completion after the app leaves playback', () => {
  const requests: { state: number; success: () => void; failure: () => void }[] = []
  const saver = new ScreenSaver({ setScreenSaver: (state, success, failure) => requests.push({ state, success: success!, failure: failure! }) })
  requests[0].success(); expect(saver.status).toBe('on')
  saver.update(true); saver.update(true); expect(requests.map(r => r.state)).toEqual([1, 0])
  saver.release(); requests[2].success(); expect(saver.status).toBe('on')
  requests[1].success(); expect(requests.map(r => r.state)).toEqual([1, 0, 1, 1])
  requests[3].success(); expect(saver.status).toBe('on')
})
it('handles missing APIs, exceptions and asynchronous errors without retries or interruption', () => {
  const missing = new ScreenSaver(); missing.update(true); missing.release(); expect(missing.status).toBe('unavailable')
  const call = vi.fn(() => { throw new Error('unsupported') })
  const saver = new ScreenSaver({ setScreenSaver: call }); expect(saver.status).toBe('failed')
  saver.update(true); saver.update(true); expect(call).toHaveBeenCalledTimes(2)
  saver.release(); expect(call).toHaveBeenCalledTimes(3)
  const failed = new ScreenSaver({ setScreenSaver: (_state, _success, failure) => failure?.() }); expect(failed.status).toBe('failed')
})
it('deduplicates visibility and page lifecycle events and resumes only in the foreground', () => {
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const suspend = vi.fn(), resume = vi.fn(), dispose = bindLifecycle(document, window, suspend, resume)
  hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'))
  window.dispatchEvent(new Event('pageshow')); expect(suspend).toHaveBeenCalledTimes(1); expect(resume).not.toHaveBeenCalled()
  hidden = false; window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange'))
  expect(resume).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('pagehide')); expect(suspend).toHaveBeenCalledTimes(2)
  dispose(); window.dispatchEvent(new Event('pageshow')); expect(resume).toHaveBeenCalledTimes(1)
})

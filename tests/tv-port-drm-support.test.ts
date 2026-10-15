import { afterEach, expect, it, vi } from 'vitest'
import { DRMSupport, type DRMResult } from '../tv-app/drm-support'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const controller = () => new AbortController()
it('queries only the fixed temporary codec configurations and never creates keys, sessions or provider requests', async () => {
  const createMediaKeys = vi.fn(), fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const requestMediaKeySystemAccess = vi.fn(async () => ({ createMediaKeys }) as unknown as MediaKeySystemAccess)
  const checker = new DRMSupport({ requestMediaKeySystemAccess }); expect(requestMediaKeySystemAccess).not.toHaveBeenCalled()
  const results = await checker.check(controller().signal)
  expect(results.profile).toBe('mp4-avc-aac-temporary-no-persistence'); expect(results.results.map(row => row.status)).toEqual(['available', 'available', 'available'])
  expect(requestMediaKeySystemAccess.mock.calls).toEqual(['com.widevine.alpha', 'com.microsoft.playready', 'org.w3.clearkey'].map(system => [system, [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }], sessionTypes: ['temporary'], persistentState: 'not-allowed', distinctiveIdentifier: 'not-allowed' }]]))
  expect(createMediaKeys).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})
it('distinguishes unsupported configuration, blocked access, unavailable API and other failures without raw errors', async () => {
  const secret = 'https://private.example/token=SECRET'
  const request = vi.fn().mockRejectedValueOnce(new DOMException(secret, 'NotSupportedError')).mockRejectedValueOnce(new DOMException(secret, 'SecurityError')).mockRejectedValueOnce(new Error(secret))
  const result = await new DRMSupport({ requestMediaKeySystemAccess: request }).check(controller().signal)
  expect(result.results.map(row => row.status)).toEqual(['not-supported', 'blocked', 'error']); expect(JSON.stringify(result)).not.toContain(secret)
  expect((await new DRMSupport({} as Navigator).check(controller().signal)).results.every(row => row.status === 'unavailable')).toBe(true)
  expect((await new DRMSupport({ requestMediaKeySystemAccess: vi.fn(() => { throw new DOMException(secret, 'NotAllowedError') }) }).check(controller().signal)).results.every(row => row.status === 'blocked')).toBe(true)
})
it('times out as inconclusive, reuses unresolved native requests and ignores their late results', async () => {
  vi.useFakeTimers()
  const pending: ((value: MediaKeySystemAccess) => void)[] = [], request = vi.fn(() => new Promise<MediaKeySystemAccess>(resolve => pending.push(resolve)))
  const checker = new DRMSupport({ requestMediaKeySystemAccess: request }), updates: DRMResult[] = []
  const first = checker.check(controller().signal, row => updates.push(row))
  await vi.advanceTimersByTimeAsync(8000); expect((await first).results.map(row => row.status)).toEqual(['timeout', 'timeout', 'timeout'])
  const second = checker.check(controller().signal); await vi.advanceTimersByTimeAsync(8000); await second; expect(request).toHaveBeenCalledTimes(3)
  pending.forEach(resolve => resolve({} as MediaKeySystemAccess)); await vi.advanceTimersByTimeAsync(0)
  expect(updates).toHaveLength(3); expect(updates.every(row => row.status === 'timeout')).toBe(true)
  request.mockImplementation(async () => ({} as MediaKeySystemAccess)); expect((await checker.check(controller().signal)).results.every(row => row.status === 'available')).toBe(true)
  expect(request).toHaveBeenCalledTimes(6); expect(vi.getTimerCount()).toBe(0)
})
it('cancels waiting and rejects pre-aborted checks without publishing late outcomes', async () => {
  vi.useFakeTimers()
  const pending: ((value: MediaKeySystemAccess) => void)[] = [], request = vi.fn(() => new Promise<MediaKeySystemAccess>(resolve => pending.push(resolve)))
  const checker = new DRMSupport({ requestMediaKeySystemAccess: request }), stopped = controller(); stopped.abort()
  await expect(checker.check(stopped.signal)).rejects.toThrow('cancelled'); expect(request).not.toHaveBeenCalled()
  const active = controller(), update = vi.fn(), task = checker.check(active.signal, update), rejected = expect(task).rejects.toThrow('cancelled')
  await vi.advanceTimersByTimeAsync(0); active.abort(); await rejected; expect(vi.getTimerCount()).toBe(0)
  for (let index = 0; index < 100; index++) {
    const retry = controller(), task = checker.check(retry.signal), rejected = expect(task).rejects.toThrow('cancelled'); retry.abort(); await rejected
  }
  const waiting = (checker as unknown as { pending: Map<string, Set<unknown>> }).pending
  expect(waiting.size).toBe(3); expect([...waiting.values()].every(listeners => listeners.size === 0)).toBe(true); expect(request).toHaveBeenCalledTimes(3)
  pending.forEach(resolve => resolve({} as MediaKeySystemAccess)); await vi.advanceTimersByTimeAsync(0); expect(update).not.toHaveBeenCalled()
})

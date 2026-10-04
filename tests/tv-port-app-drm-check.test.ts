// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('connects the manual DRM check to app navigation and background lifecycle', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const pending: ((value: MediaKeySystemAccess) => void)[] = [], request = vi.fn(() => new Promise<MediaKeySystemAccess>(resolve => pending.push(resolve)))
  vi.stubGlobal('navigator', { requestMediaKeySystemAccess: request, onLine: navigator.onLine, language: navigator.language, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(0) }
  await click('setup-diagnostics'); expect(request).not.toHaveBeenCalled()
  await click('diagnostics-drm-check'); expect(request).toHaveBeenCalledTimes(3)
  hidden = true; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0)
  expect(el('diagnostics-drm-status').textContent).toContain('away'); expect(document.activeElement).toBe(el('diagnostics-drm-check'))
  await click('diagnostics-drm-check'); expect(request).toHaveBeenCalledTimes(3)
  hidden = false; document.dispatchEvent(new Event('visibilitychange')); await click('diagnostics-drm-check'); await click('diagnostics-back')
  pending.forEach(resolve => resolve({} as MediaKeySystemAccess)); await vi.advanceTimersByTimeAsync(0)
  expect(el('setup').hidden).toBe(false); expect(el<HTMLTextAreaElement>('diagnostics-text').value).toBe('')
  await click('setup-diagnostics'); expect(el('diagnostics-drm-results').textContent).toContain('Not checked'); expect(request).toHaveBeenCalledTimes(3)
  vi.clearAllTimers()
})

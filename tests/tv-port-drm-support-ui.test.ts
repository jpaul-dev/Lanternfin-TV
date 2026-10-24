// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { diagnosticsUI } from '../tv-app/diagnostics-ui'
import { capabilities, PlaybackDiagnostics, buildInfo } from '../tv-app/diagnostics'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function setup(request: Navigator['requestMediaKeySystemAccess']) {
  vi.stubGlobal('navigator', { onLine: true, requestMediaKeySystemAccess: request })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(`diagnostics-${id}`) as T
  const log = new PlaybackDiagnostics(), root = document.getElementById('diagnostics')!
  const ui = diagnosticsUI(root, () => ({ schema: 1, app: buildInfo('browser'), capabilities: capabilities(document.createElement('video')), samsungPlayer: false, screenSaver: 'unavailable', playback: log.snapshot() }), () => log.clear())
  root.hidden = false; ui.open()
  return { ui, el, click: (id: string) => el(id).click(), report: () => JSON.parse(el<HTMLTextAreaElement>('text').value) }
}
it('runs only on request, reports scoped outcomes, preserves them on refresh and clears them explicitly', async () => {
  vi.useFakeTimers()
  const request = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new DOMException('PRIVATE error', 'NotSupportedError')).mockResolvedValueOnce({})
  const { ui, el, click, report } = setup(request)
  expect(request).not.toHaveBeenCalled(); expect(report()).not.toHaveProperty('drm'); expect(el('drm-results').textContent).toContain('Not checked')
  click('drm-check'); expect(el<HTMLButtonElement>('drm-check').disabled).toBe(true); expect(document.activeElement).toBe(el('drm-cancel'))
  await vi.advanceTimersByTimeAsync(0)
  expect(request).toHaveBeenCalledTimes(3); expect(el('drm-results').textContent).toContain('Configuration accepted'); expect(el('drm-results').textContent).toContain('Configuration not supported')
  expect(report().drm.results).toHaveLength(3); expect(JSON.stringify(report())).not.toContain('PRIVATE'); expect(document.activeElement).toBe(el('drm-check'))
  click('refresh'); expect(request).toHaveBeenCalledTimes(3); expect(report().drm.results).toHaveLength(3)
  ui.close(); ui.open(); expect(report().drm.results).toHaveLength(3)
  click('clear'); expect(report()).not.toHaveProperty('drm'); expect(el('drm-status').textContent).toBe('')
})
it('stops on cancellation, navigation and backgrounding without stale changes or duplicate pending device requests', async () => {
  vi.useFakeTimers()
  const pending: ((value: MediaKeySystemAccess) => void)[] = [], request = vi.fn(() => new Promise<MediaKeySystemAccess>(resolve => pending.push(resolve)))
  const { ui, el, click, report } = setup(request)
  click('drm-check'); await vi.advanceTimersByTimeAsync(0); click('drm-cancel'); expect(document.activeElement).toBe(el('drm-check'))
  click('drm-check'); await vi.advanceTimersByTimeAsync(0); expect(request).toHaveBeenCalledTimes(3)
  ui.suspend(); expect(el('drm-status').textContent).toContain('away'); expect(el<HTMLButtonElement>('drm-check').disabled).toBe(false)
  click('drm-check'); await vi.advanceTimersByTimeAsync(0); ui.close()
  pending.forEach(resolve => resolve({} as MediaKeySystemAccess)); await vi.advanceTimersByTimeAsync(0)
  expect(el<HTMLTextAreaElement>('text').value).toBe(''); expect(el('drm-status').textContent).toBe(''); expect(request).toHaveBeenCalledTimes(3)
  ui.open(); expect(report()).not.toHaveProperty('drm'); expect(el('drm-results').textContent).toContain('Not checked'); expect(vi.getTimerCount()).toBe(0)
})

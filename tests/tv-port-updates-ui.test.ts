// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { updatesUI } from '../tv-app/updates-ui'
import type { UpdateCheck } from '../tv-app/updates'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const el = (id: string) => document.getElementById(`updates-${id}`)!
const markup = () => { document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); document.getElementById('updates')!.hidden = false }
it('makes no automatic request, distinguishes a modified build and safely renders target-matching releases', async () => {
  vi.useFakeTimers(); markup()
  vi.stubGlobal('__TV_BUILD__', { version: '0.1.0', commit: 'a'.repeat(40), dirty: true })
  const check = vi.fn().mockResolvedValue({ commit: 'a'.repeat(40), releases: [{ name: '<script>Unsafe</script>', url: 'https://github.com/jpaul-dev/Lanternfin-TV/releases/tag/test', prerelease: true, targets: ['webos'] }, { name: 'Other platform', targets: ['tizen'] }], errors: [] })
  const view = updatesUI(document.getElementById('updates')!, 'webos', check)
  view.open(); expect(check).not.toHaveBeenCalled()
  el('check').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('result').textContent).toContain('local changes')
  expect(el('packages').querySelectorAll('script')).toHaveLength(0)
  expect(el('packages').textContent).not.toContain('Other platform')
  expect(el('packages').textContent).toContain('filename does not verify')
  el('check').click(); expect(check).toHaveBeenCalledTimes(1); expect(el('status').textContent).toContain('wait a minute')
})
it('discards a late check result after leaving the screen', async () => {
  vi.useFakeTimers(); markup()
  let resolve: (result: UpdateCheck) => void = () => {}
  const check = vi.fn(() => new Promise<UpdateCheck>(done => { resolve = done }))
  const view = updatesUI(document.getElementById('updates')!, 'tizen', check)
  view.open(); el('check').click(); const signal = check.mock.calls[0]?.[0] as unknown as AbortSignal
  view.close(); expect(signal.aborted).toBe(true)
  resolve({ commit: 'b'.repeat(40), releases: [], errors: [] }); await vi.advanceTimersByTimeAsync(0)
  expect(el('result').textContent).toBe('')
})

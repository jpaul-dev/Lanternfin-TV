// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { updatesUI } from '../tv-app/updates-ui'
import type { UpdateCheck } from '../tv-app/updates'
import type { UpdateChannel } from '../tv-app/preferences'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const el = (id: string) => document.getElementById(`updates-${id}`)!
const markup = () => { document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); document.getElementById('updates')!.hidden = false }
it('makes no automatic request, distinguishes a modified build and safely renders target-matching releases', async () => {
  vi.useFakeTimers(); markup()
  vi.stubGlobal('__TV_BUILD__', { version: '0.1.0', commit: 'a'.repeat(40), dirty: true })
  const check = vi.fn().mockResolvedValue({ commit: 'a'.repeat(40), releases: [{ name: '<script>Unsafe</script>', url: 'https://github.com/jpaul-dev/Lanternfin-TV/releases/tag/test', prerelease: true, targets: ['webos'] }, { name: 'Other platform', targets: ['tizen'] }], errors: [] })
  const view = updatesUI(document.getElementById('updates')!, 'webos', check, () => 'beta')
  view.open(); expect(check).not.toHaveBeenCalled()
  el('check').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('result').textContent).toContain('local changes')
  expect(el('packages').querySelectorAll('script')).toHaveLength(0)
  expect(el('packages').textContent).not.toContain('Other platform')
  expect(el('packages').textContent).toContain('filename does not verify')
  el('check').click(); expect(check).toHaveBeenCalledTimes(1); expect(el('status').textContent).toContain('wait a minute')
})
it('filters channel and platform before limiting rows, clears obsolete results and labels beta releases', async () => {
  vi.useFakeTimers(); markup()
  vi.stubGlobal('__TV_BUILD__', { version: '0.1.0', commit: 'a'.repeat(40), dirty: false })
  const release = (name: string, prerelease: boolean, target: 'webos' | 'tizen') => ({ name, prerelease, targets: [target], url: `https://github.com/jpaul-dev/Lanternfin-TV/releases/tag/${name}` })
  const releases = Array.from({ length: 10 }, (_, i) => release(`beta-${i}`, true, 'webos'))
  releases.push(release('samsung-stable', false, 'tizen'), release('lg-stable', false, 'webos'))
  const check = vi.fn().mockResolvedValue({ releases, errors: [] })
  let channel: UpdateChannel = 'stable'
  const view = updatesUI(document.getElementById('updates')!, 'webos', check, () => channel)
  view.open(); expect(el('channel').textContent).toContain('Stable · excludes prereleases')
  el('check').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('packages').querySelectorAll('a')).toHaveLength(1)
  expect(el('packages').textContent).toContain('lg-stable'); expect(el('packages').textContent).not.toContain('beta-')
  view.close(); channel = 'beta'; view.open()
  expect(el('packages').textContent).toBe(''); expect(el('channel').textContent).toContain('Beta · includes stable')
  el('check').click(); expect(check).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60000); el('check').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('packages').querySelectorAll('a')).toHaveLength(10); expect(el('packages').textContent).toContain('beta-0 · Prerelease')
  releases.splice(0, 9)
  await vi.advanceTimersByTimeAsync(60000); el('check').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('packages').querySelectorAll('a')).toHaveLength(2)
  expect(el('packages').textContent).toContain('lg-stable'); expect(el('packages').textContent).not.toContain('samsung-stable')
  view.close(); channel = 'stable'; view.open(); expect(el('packages').textContent).toBe('')
  releases.splice(1)
  await vi.advanceTimersByTimeAsync(60000); el('check').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('packages').textContent).toContain('No stable TV package matching this platform')
  expect(el('packages').querySelectorAll('a')).toHaveLength(0)
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

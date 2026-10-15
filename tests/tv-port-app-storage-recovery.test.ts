// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import type { AVPlay } from '../tv-app/player'

afterEach(() => { delete window.webapis; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('paces failed progress saves, keeps failed favorite edits honest, and recovers during playback', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'tizen')
  let nativeState = 'NONE', position = 120000
  const native: AVPlay = {
    open: () => { nativeState = 'IDLE' }, close: () => { nativeState = 'NONE' }, stop: () => { nativeState = 'IDLE' },
    play: () => { nativeState = 'PLAYING' }, pause: () => { nativeState = 'PAUSED' }, getState: () => nativeState,
    getDuration: () => 600000, getCurrentTime: () => position, setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
    setListener: vi.fn(), prepareAsync: success => success(), seekTo: (_time, success) => success(),
  }
  Object.assign(window, { webapis: { avplay: native } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  el<HTMLSelectElement>('source-kind').value = 'direct'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.test/movie.mp4'; el<HTMLInputElement>('remember').checked = true
  await click('connect')
  let failing = true, writes = 0, key = ''
  const set = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (name, value) {
    if (name.startsWith('lanternfin.tv.library.')) { key = name; writes++; if (failing) throw new DOMException('Full', 'QuotaExceededError') }
    return set.call(this, name, value)
  })
  ;(el('channels').querySelector('button') as HTMLButtonElement).click(); await vi.advanceTimersByTimeAsync(0)
  expect(nativeState).toBe('PLAYING'); expect(writes).toBe(1)
  expect(el('library-note').textContent).toContain('kept for this session')
  await vi.advanceTimersByTimeAsync(10000); expect(writes).toBe(1)
  await vi.advanceTimersByTimeAsync(1000); expect(writes).toBe(2)
  await click('favorite'); expect(el('favorite').getAttribute('aria-pressed')).toBe('false')
  expect(writes).toBe(3); expect(el('player-status').textContent).toContain('previous library was kept')
  failing = false; position = 150000
  await vi.advanceTimersByTimeAsync(11000); expect(writes).toBe(4)
  expect(JSON.parse(localStorage.getItem(key)!).recent[0].position).toBe(150)
  expect(el('library-note').textContent).not.toContain('could not save')
  expect(nativeState).toBe('PLAYING'); expect(el('playback').hidden).toBe(false)
  await click('stop'); await click('nav-settings'); await click('settings-source')
  el<HTMLInputElement>('remember').checked = false; await click('connect')
  expect(localStorage.getItem(key)).toBeNull()
  await click('nav-settings'); await click('settings-source')
  el<HTMLInputElement>('remember').checked = true; failing = true; await click('connect')
  expect(el('library-note').textContent).toContain('Your source is saved, but library changes last for this session')
  const attempts = writes
  ;(el('channels').querySelector('button') as HTMLButtonElement).click(); await vi.advanceTimersByTimeAsync(0)
  await click('resume-continue'); await vi.advanceTimersByTimeAsync(11000); expect(writes).toBe(attempts)
  await click('stop'); expect(writes).toBe(attempts)
  failing = false; await click('nav-settings'); await click('settings-source'); await click('connect')
  expect(writes).toBe(attempts + 1); expect(el('library-note').textContent).toBe('Favorites and recent streams are saved on this TV.')
  expect(JSON.parse(localStorage.getItem(key)!).recent[0].position).toBe(150)
  vi.clearAllTimers()
})

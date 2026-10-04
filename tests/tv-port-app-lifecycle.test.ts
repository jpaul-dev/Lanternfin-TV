// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import type { AVPlay } from '../tv-app/player'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('saves playback on leaving, clears transient backup secrets, and respects manually paused indexing', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'tizen')
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const saver = vi.fn((_state, success) => success?.())
  let nativeState = 'NONE'
  const native: AVPlay = {
    open: () => { nativeState = 'IDLE' }, close: () => { nativeState = 'NONE' }, stop: () => { nativeState = 'IDLE' },
    play: () => { nativeState = 'PLAYING' }, pause: () => { nativeState = 'PAUSED' }, getState: () => nativeState,
    getDuration: () => 600000, getCurrentTime: () => 120000, setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
    setListener: vi.fn(), prepareAsync: success => success(), seekTo: (_time, success) => success(),
  }
  Object.assign(window, { webapis: { avplay: native, appcommon: { setScreenSaver: saver } } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const visibility = async (value: boolean) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) }
  el<HTMLSelectElement>('source-kind').value = 'direct'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.com/movie.mp4'
  await click('connect'); (el('channels').querySelector('button') as HTMLButtonElement).click()
  expect(saver).toHaveBeenLastCalledWith(0, expect.any(Function), expect.any(Function))
  await visibility(true); expect(el('playback').hidden).toBe(true)
  expect(saver).toHaveBeenLastCalledWith(1, expect.any(Function), expect.any(Function))
  await visibility(false); expect(el('playback').hidden).toBe(true)
  ;(el('channels').querySelector('button') as HTMLButtonElement).click()
  expect(el('resume').hidden).toBe(false); expect(el('resume-description').textContent).toContain('2:00')
  await click('resume-back'); await click('nav-settings'); await click('settings-backup')
  el<HTMLInputElement>('backup-passphrase').value = 'temporary secret'; await visibility(true)
  expect(el<HTMLInputElement>('backup-passphrase').value).toBe(''); await visibility(false)
  await click('backup-back'); await click('settings-source')
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.com'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  const requests: AbortSignal[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
    if (new URL(url).searchParams.get('action') === 'get_live_categories') return Promise.resolve(new Response('[{"category_id":"1","category_name":"Live"}]'))
    requests.push(options.signal!); return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError'))))
  }))
  await click('connect'); expect(el('index-toggle').textContent).toBe('Pause loading')
  await visibility(true); expect(requests.at(-1)?.aborted).toBe(true)
  expect(el('index-toggle').textContent).toBe('Continue loading')
  await visibility(false); expect(el('index-toggle').textContent).toBe('Pause loading')
  await click('index-toggle'); const count = requests.length
  await visibility(true); await visibility(false); expect(requests).toHaveLength(count)
  expect(el('index-toggle').textContent).toBe('Continue loading')
  delete window.webapis; vi.clearAllTimers()
})

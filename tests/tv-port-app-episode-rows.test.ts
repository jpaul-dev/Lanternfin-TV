// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('pages episode rows with arrows/page keys and returns playback to the actual episode after crossing a page boundary', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const action = new URL(address).searchParams.get('action')
    const data = action === 'get_series_categories' ? [{ category_id: '1', category_name: 'Shows' }] : action === 'get_series' ? [{ series_id: '1', name: 'Episode demo' }]
      : action === 'get_series_info' ? { info: { plot: 'Series overview' }, episodes: { 1: Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), season: 1, episode_num: i + 1, title: `Episode ${i + 1}`, info: { duration_secs: 2700, plot: `Synopsis ${i + 1}` } })) } } : []
    return new Response(JSON.stringify(data))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const key = async (key: string) => { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await vi.advanceTimersByTimeAsync(0) }
  const rows = () => [...el('episode-grid').querySelectorAll<HTMLButtonElement>('button')]
  const focused = () => document.activeElement?.querySelector('.card-title')?.textContent
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://provider.example'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); await click('nav-series'); el('channels').querySelector<HTMLButtonElement>('button')!.click(); await vi.advanceTimersByTimeAsync(500)
  expect(rows()).toHaveLength(24); expect(rows()[0].classList.contains('episode-row')).toBe(true); expect(rows()[0].textContent).toContain('45:00'); expect(rows()[0].textContent).toContain('Synopsis 1')
  rows()[23].focus(); await key('ArrowDown'); expect(el('episode-page').textContent).toBe('Page 2 of 2'); expect(focused()).toBe('S1 E25 · Episode 25')
  await key('ArrowUp'); expect(el('episode-page').textContent).toBe('Page 1 of 2'); expect(focused()).toBe('S1 E24 · Episode 24')
  rows()[3].focus(); await key('PageDown'); expect(focused()).toBe('S1 E25 · Episode 25'); await key('PageUp'); expect(focused()).toBe('S1 E24 · Episode 24')
  rows()[23].click(); await vi.advanceTimersByTimeAsync(500)
  const video = document.querySelector('video')!; Object.defineProperty(video, 'duration', { value: 2800 }); video.currentTime = 120; video.dispatchEvent(new Event('playing'))
  await click('play-next'); video.dispatchEvent(new Event('playing')); await click('stop')
  expect(el('detail').hidden).toBe(false); expect(el('episode-page').textContent).toBe('Page 2 of 2'); expect(focused()).toBe('S1 E25 · Episode 25')
  rows()[0].focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); await click('card-menu-watched')
  expect(focused()).toBe('S1 E25 · Episode 25'); expect(rows()[0].querySelector('.watched-badge')).not.toBeNull()
  vi.clearAllTimers()
})

// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('connects Home focus to the matching detail action, suspends on other views, and clears the previous source', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear(); sessionStorage.clear()
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  let prefix = 'First'
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n' + [1, 2, 3].map(id => `#EXTINF:-1 tvg-type="movie" group-title="Drama",${prefix} movie ${id}\nhttps://example.test/${prefix}/${id}.mp4`).join('\n'))))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(250) }
  el<HTMLInputElement>('source-url').value = 'https://example.test/first.m3u'; await click('connect')
  expect(el('hero-title').textContent).toBe('First movie 1')
  const card = el('home-rows').querySelectorAll<HTMLButtonElement>('.channel')[1]; card.focus(); await vi.advanceTimersByTimeAsync(80)
  expect(el('hero-title').textContent).toBe('First movie 2')
  await click('hero-play'); expect(el('detail').hidden).toBe(false); expect(el('detail-title').textContent).toBe('First movie 2')
  await vi.advanceTimersByTimeAsync(20000); expect(el('hero-title').textContent).toBe('First movie 2')
  await click('nav-home'); await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe('First movie 3')
  await click('nav-movie'); const title = el('hero-title').textContent; await vi.advanceTimersByTimeAsync(20000); expect(el('hero-title').textContent).toBe(title)
  await click('nav-home'); await click('change-source'); await click('profile-new')
  prefix = 'Second'; el<HTMLInputElement>('source-url').value = 'https://example.test/second.m3u'; await click('connect')
  expect(el('hero-title').textContent).toBe('Second movie 1'); expect(el('home-rows').textContent).not.toContain('First movie')
  window.dispatchEvent(new Event('pagehide')); const paused = el('hero-title').textContent
  await vi.advanceTimersByTimeAsync(20000); expect(el('hero-title').textContent).toBe(paused)
  window.dispatchEvent(new Event('pageshow')); await vi.advanceTimersByTimeAsync(10000); expect(el('hero-title').textContent).toBe('Second movie 2')
  vi.clearAllTimers()
})

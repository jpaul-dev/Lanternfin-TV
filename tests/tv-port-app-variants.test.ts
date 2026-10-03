// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('groups home and catalog movies, chooses the preferred language, and keeps alternate favorites separate', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n' + ['EN - Film (2020)', 'FR - Film (2020)', 'FR - Film (2021)'].map((name, i) => `#EXTINF:-1 tvg-type="movie",${name}\nhttps://example.com/${i}.mp4\n`).join(''))))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const change = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; await click('connect')
  await click('nav-settings'); await change('pref-grouping', 'true'); await change('pref-content', 'fr'); await click('settings-back')
  expect(el('home-rows').querySelectorAll('button')).toHaveLength(2); expect(el('home-rows').textContent).toContain('2 versions')
  expect(el('hero-title').textContent).toBe('FR - Film (2020)')
  await click('hero-play'); expect(el('detail-versions').hidden).toBe(false); expect(el('detail-title').textContent).toBe('FR - Film (2020)')
  await change('detail-version', '0'); expect(el('detail-title').textContent).toBe('EN - Film (2020)')
  await click('detail-favorite'); await change('detail-version', '1'); expect(el('detail-favorite').getAttribute('aria-pressed')).toBe('false')
  await click('detail-back'); await click('nav-movie'); expect(el('channels').querySelectorAll('button')).toHaveLength(2)
  await change('language-filter', 'EN'); expect(el('channels').querySelectorAll('button')).toHaveLength(1); expect(el('channels').textContent).not.toContain('versions')
  await click('view-favorites'); expect(el('channels').querySelectorAll('button')).toHaveLength(1); expect(el('channels').textContent).toContain('EN - Film')
  await click('nav-settings'); await change('pref-grouping', 'false'); await click('nav-movie'); await click('reset-filters'); expect(el('channels').querySelectorAll('button')).toHaveLength(3)
  vi.clearAllTimers()
})

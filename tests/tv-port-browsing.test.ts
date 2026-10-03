// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('pages poster grids by remote, jumps by page number, and combines provider-language and watched filters', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const playlist = '#EXTM3U\n' + Array.from({ length: 60 }, (_, i) => `#EXTINF:-1 tvg-type="movie",${i % 2 ? 'FR' : 'EN'} - Movie ${i + 1}\nhttps://example.com/${i}.mp4\n`).join('')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(playlist)))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = this.parentElement?.id === 'channels' ? [...this.parentElement.children].indexOf(this) : 0
    return { left: index % 6 * 100, top: Math.floor(index / 6) * 150, width: 80, height: 130 } as DOMRect
  })
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const key = async (key: string) => { document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await vi.advanceTimersByTimeAsync(0) }
  const change = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  const card = (index: number) => el('channels').querySelectorAll<HTMLButtonElement>('button')[index]
  el<HTMLInputElement>('source-url').value = 'https://example.com/library.m3u'; await click('connect'); await click('nav-movie')
  expect(el('result-count').textContent).toContain('60 titles'); card(22).focus(); await key('ArrowDown')
  expect(el('page-label').textContent).toBe('Page 2 of 3'); expect(document.activeElement?.textContent).toContain('Movie 29')
  await key('ArrowUp'); expect(el('page-label').textContent).toBe('Page 1 of 3'); expect(document.activeElement?.textContent).toContain('Movie 23')
  await key('PageDown'); expect(el('page-label').textContent).toBe('Page 2 of 3')
  el<HTMLInputElement>('page-jump').value = '3'; await click('page-go'); expect(card(0).textContent).toContain('Movie 49')
  el<HTMLInputElement>('page-jump').value = '999'; await click('page-go'); expect(el('page-label').textContent).toBe('Page 3 of 3')
  await change('language-filter', 'FR'); expect(el('result-count').textContent).toContain('30 titles'); expect(el('page-label').textContent).toBe('Page 1 of 2')
  expect(card(0).textContent).toContain('FR - Movie 2')
  card(0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await click('card-menu-watched')
  await change('watched-filter', 'watched'); expect(el('result-count').textContent).toContain('1 title'); expect(card(0).textContent).toContain('Movie 2')
  card(0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await click('card-menu-watched')
  expect(el('result-count').textContent).toContain('0 titles'); expect(el('browse-empty').hidden).toBe(false); expect(el('empty-title').textContent).toBe('No matching titles')
  await click('empty-clear'); expect(el('result-count').textContent).toContain('60 titles'); expect(el('browse-empty').hidden).toBe(true)
  vi.clearAllTimers()
})

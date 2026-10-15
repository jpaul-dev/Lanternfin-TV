// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import * as search from '../tv-app/search'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('blocks old-result paging throughout debounce and scanning and retains usable focus when a result disappears', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n' + Array.from({ length: 96 }, (_, i) => `#EXTINF:-1 tvg-type="movie",${i < 48 ? 'Keep' : 'Other'} Film ${i + 1}\nhttps://example.test/${i}.mp4\n`).join(''))))
  const originalSearch = search.searchCatalog
  let delay = false, release: (() => void) | undefined
  vi.spyOn(search, 'searchCatalog').mockImplementation(async (...args) => { if (delay) await new Promise<void>(done => { release = done }); return originalSearch(...args) })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const cards = () => [...el('channels').querySelectorAll<HTMLButtonElement>('button')]
  const query = (value: string) => { el<HTMLInputElement>('search').value = value; el('search').focus(); el('search').dispatchEvent(new Event('input')) }
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; await click('connect'); await click('nav-movie')
  el<HTMLInputElement>('page-jump').value = '3'; await click('page-go')
  const previous = el('channels').textContent
  delay = true; query('Keep')
  expect(el('channels').getAttribute('aria-busy')).toBe('true')
  for (const id of ['previous', 'next', 'page-go']) expect(el<HTMLButtonElement>(id).disabled).toBe(true)
  el<HTMLInputElement>('page-jump').value = '2'; el('page-go').click(); el('next').click()
  expect(el('page-label').textContent).toBe('Page 3 of 4'); expect(el('channels').textContent).toBe(previous); expect(document.activeElement?.id).toBe('search')
  await vi.advanceTimersByTimeAsync(200)
  expect(release).toBeTypeOf('function'); expect(el<HTMLButtonElement>('page-go').disabled).toBe(true)
  delay = false; release!(); await vi.advanceTimersByTimeAsync(500)
  expect(el('channels').getAttribute('aria-busy')).toBe('false'); expect(el('page-label').textContent).toBe('Page 1 of 2')
  expect(el<HTMLButtonElement>('next').disabled).toBe(false); expect(el<HTMLButtonElement>('previous').disabled).toBe(true)
  expect(document.activeElement?.id).toBe('search'); expect(cards()[0].textContent).toContain('Keep Film 1')
  query('Other'); cards()[4].focus(); await vi.advanceTimersByTimeAsync(500)
  expect(document.activeElement).toBe(cards()[4]); expect(document.activeElement?.textContent).toContain('Other Film 53')
  query('No matching movie'); cards()[4].focus(); await vi.advanceTimersByTimeAsync(500)
  expect(el('browse-empty').hidden).toBe(false); expect(document.activeElement?.id).toBe('empty-clear')
  vi.clearAllTimers()
})

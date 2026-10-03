// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('restores playlist groups and does not turn a removed group into the entire library', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let removed = false
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n' + ['First', ...removed ? [] : ['Second']].flatMap(group => Array.from({ length: 60 }, (_, i) => `#EXTINF:-1 tvg-type="movie" group-title="${group}",${group} Film ${i + 1}\nhttps://example.com/${group}/${i}.mp4\n`)).join(''))))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; await click('connect'); await click('nav-movie')
  el('category-list').querySelectorAll<HTMLButtonElement>('button')[1].click(); await vi.advanceTimersByTimeAsync(0)
  el<HTMLInputElement>('page-jump').value = '2'; await click('page-go'); el('channels').querySelectorAll<HTMLButtonElement>('button')[4].focus()
  await click('nav-home'); await click('nav-movie')
  expect(el<HTMLSelectElement>('group').value).toBe('Second'); expect(el('page-label').textContent).toBe('Page 2 of 3')
  expect(document.activeElement?.querySelector('.card-title')?.textContent).toBe('Second Film 29')
  expect(el('category-list').querySelectorAll<HTMLButtonElement>('button')[1].getAttribute('aria-pressed')).toBe('true')
  removed = true; await click('refresh-catalog'); await click('nav-movie')
  expect(el<HTMLSelectElement>('group').value).toBe('Second'); expect(el('channels').querySelectorAll('button')).toHaveLength(0)
  await click('empty-clear'); expect(el<HTMLSelectElement>('group').value).toBe(''); expect(el('channels').textContent).toContain('First Film')
  el<HTMLInputElement>('search').focus(); el<HTMLInputElement>('search').value = 'Film 1'; el('search').dispatchEvent(new Event('input'))
  await click('nav-home'); await click('nav-movie')
  expect(el<HTMLInputElement>('search').value).toBe('Film 1'); expect(document.activeElement?.id).toBe('search')
  vi.clearAllTimers()
})

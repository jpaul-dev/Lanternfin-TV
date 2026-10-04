// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'
import { validateSource } from '../tv-app/catalog'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('applies playlist category edits throughout Home, favorites, search, guide and restored browsing', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n' + [
    '#EXTINF:-1 tvg-type="live" group-title="Sports",Sports channel\nhttps://example.test/sports.m3u8',
    '#EXTINF:-1 tvg-type="live" group-title="News",News channel\nhttps://example.test/news.m3u8',
    '#EXTINF:-1 tvg-type="movie" group-title="Sports",Sports movie\nhttps://example.test/sport.mp4',
    '#EXTINF:-1 tvg-type="movie" group-title="Films",Other movie\nhttps://example.test/film.mp4',
  ].join('\n'))))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const choice = async (selector: string) => { document.querySelector<HTMLElement>(selector)!.click(); await vi.advanceTimersByTimeAsync(500) }
  const names = () => el('channels').textContent
  const source = validateSource({ kind: 'playlist', url: 'https://example.test/list.m3u', username: '', password: '' })
  el<HTMLInputElement>('source-url').value = source.url; el<HTMLInputElement>('remember').checked = true; await click('connect')
  await click('nav-movie'); await choice('#category-list [data-category="Sports"]'); await choice('#channels button'); await click('detail-favorite'); await click('detail-back')
  await click('nav-live'); expect(el('schedule-rows').textContent).toContain('Sports channel')
  await click('nav-settings'); await click('settings-categories'); await choice('#visibility-list [data-category="Sports"]')
  await choice('#visibility [data-kind="movie"]'); await choice('#visibility-list [data-category="Sports"]'); await click('visibility-save')
  expect(document.activeElement?.id).toBe('settings-categories'); expect(el('settings-note').textContent).toContain('saved')
  await click('nav-home'); expect(el('home-content').textContent).not.toContain('Sports channel'); expect(el('home-content').textContent).not.toContain('Sports movie'); expect(el('home-content').textContent).toContain('Other movie')
  await click('nav-live'); expect(el('schedule-rows').textContent).not.toContain('Sports channel'); expect(el('schedule-rows').textContent).toContain('News channel')
  await click('schedule-category'); expect(el('schedule-categories').textContent).not.toContain('Sports')
  await click('nav-movie'); expect(names()).not.toContain('Sports movie'); expect(names()).toContain('Other movie'); expect(el<HTMLSelectElement>('group').value).toBe('')
  expect(el('category-list').textContent).toBe('Films')
  await click('view-favorites'); expect(names()).not.toContain('Sports movie')
  await click('nav-search'); expect(names()).not.toContain('Sports'); expect(names()).toContain('News channel')
  const saved = new TVLibrary(localStorage, source); expect(saved.favorites.size).toBe(1); expect(saved.categoryRules.live?.ids).toEqual(['Sports'])
  await click('nav-settings'); await click('settings-categories'); await click('visibility-reset'); await choice('#visibility [data-kind="movie"]'); await click('visibility-reset'); await click('visibility-save')
  await click('nav-movie'); await click('view-favorites'); expect(names()).toContain('Sports movie')
  await click('nav-live'); expect(el('schedule-rows').textContent).toContain('Sports channel')
  vi.clearAllTimers()
})

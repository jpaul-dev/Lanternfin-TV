// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'
import { validateSource } from '../tv-app/catalog'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('ranks the displayed language version and keeps section/source filters separate through navigation and reset', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const action = new URL(address).searchParams.get('action')
    if (!action) return new Response('#EXTM3U\n#EXTINF:-1 tvg-type="movie",Playlist film\nhttps://example.com/film.mp4\n')
    const data = action.endsWith('_categories') ? [{ category_id: '1', category_name: 'Collection' }]
      : action === 'get_vod_streams' ? [{ stream_id: '1', name: 'EN - Film (2024)', rating: '9', container_extension: 'mp4' }, { stream_id: '2', name: 'FR - Film (2024)', rating: '7', container_extension: 'mp4' }, { stream_id: '3', name: 'EN - Another film', rating: '8', container_extension: 'mp4' }, { stream_id: '4', name: 'Unrated film', container_extension: 'mp4' }]
      : action === 'get_series' ? [{ series_id: '5', name: 'FR - Saga', rating: '8' }, { series_id: '6', name: 'EN - Other show', rating: '5' }]
      : action === 'get_live_streams' ? [{ stream_id: '7', name: 'TV channel' }]
      : action === 'get_vod_info' ? { info: { name: 'FR - Film (2024)' } } : {}
    return new Response(JSON.stringify(data))
  }))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(250) }
  const change = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(250) }
  const options = () => ['sort-order', 'watched-filter', 'language-filter', 'media-filter'].map(id => el<HTMLSelectElement>(id).value)
  const names = () => [...el('channels').querySelectorAll('.card-title')].map(item => item.textContent?.replace(/^★ /, ''))
  const account = validateSource({ kind: 'xtream', url: 'https://provider.example', username: 'demo', password: 'demo' })
  await change('source-kind', 'xtream'); el<HTMLInputElement>('source-url').value = account.url
  el<HTMLInputElement>('username').value = 'demo'; el<HTMLInputElement>('password').value = 'demo'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-movie'); await change('sort-order', 'rating')
  expect(names()).toEqual(['EN - Film (2024)', 'EN - Another film', 'FR - Film (2024)', 'Unrated film'])
  await click('nav-settings'); await change('pref-grouping', 'true'); await change('pref-content', 'fr'); await click('nav-movie')
  expect(names()).toEqual(['EN - Another film', 'FR - Film (2024)', 'Unrated film'])
  await change('watched-filter', 'unwatched'); await change('language-filter', 'FR')
  expect(names()).toEqual(['FR - Film (2024)'])
  el('channels').querySelector<HTMLButtonElement>('button')!.click(); await vi.advanceTimersByTimeAsync(250)
  await click('detail-favorite'); await click('detail-back'); await click('view-favorites')
  expect(options()).toEqual(['provider', 'all', '', '']); expect(names()).toEqual(['FR - Film (2024)'])
  await change('media-filter', 'series'); expect(names()).toEqual([])
  await click('nav-series'); expect(options()).toEqual(['provider', 'all', '', '']); expect(names()).toHaveLength(2)
  await change('sort-order', 'name-desc'); await change('watched-filter', 'watched'); expect(names()).toEqual([])
  await click('nav-search'); expect(options()).toEqual(['provider', 'all', '', ''])
  await change('media-filter', 'movie'); await change('sort-order', 'newest')
  await click('nav-live'); expect(options()).toEqual(['provider', 'all', '', '']); expect(names()).toEqual(['TV channel'])
  await click('nav-movie'); expect(options()).toEqual(['rating', 'unwatched', 'FR', '']); expect(names()).toEqual(['FR - Film (2024)'])
  await click('reset-filters'); expect(options()).toEqual(['provider', 'all', '', ''])
  await click('nav-series'); expect(options()).toEqual(['name-desc', 'watched', '', ''])
  await click('nav-search'); expect(options()).toEqual(['newest', 'all', '', 'movie'])
  await click('view-favorites'); expect(options()).toEqual(['provider', 'all', '', 'series'])
  await click('change-source'); await click('profile-new'); el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-series'); expect(options()).toEqual(['provider', 'all', '', ''])
  await click('nav-movie'); await change('sort-order', 'rating'); expect(el('sort-note').textContent).toContain('no ratings')
  await change('sort-order', 'name-asc')
  await click('change-source'); await click('profile-new'); await change('source-kind', 'xtream'); el<HTMLInputElement>('source-url').value = account.url
  el<HTMLInputElement>('username').value = 'demo'; el<HTMLInputElement>('password').value = 'demo'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-series'); expect(options()).toEqual(['name-desc', 'watched', '', ''])
  expect(new TVLibrary(localStorage, account).browseChoice('search').media).toBe('movie')
  vi.clearAllTimers()
})

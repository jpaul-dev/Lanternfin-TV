// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'
import { validateSource } from '../tv-app/catalog'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('saves a provider category by ID, opens its full grid, and isolates a later playlist layout', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  let playlistGroup = 'Drama', failCategoryOnce = true
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const url = new URL(address), action = url.searchParams.get('action')
    if (!action) return new Response(`#EXTM3U\n#EXTINF:-1 tvg-type="movie" group-title="${playlistGroup}",Playlist movie\nhttps://example.com/movie.mp4\n`)
    if (action === 'get_vod_streams' && url.searchParams.get('category_id') === '2' && failCategoryOnce) { failCategoryOnce = false; return new Response('', { status: 503 }) }
    const data = action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'Drama' }, { category_id: '2', category_name: 'Drama' }]
      : action === 'get_vod_streams' ? Array.from({ length: 20 }, (_, index) => ({ stream_id: `${url.searchParams.get('category_id')}${index}`, name: `Category ${url.searchParams.get('category_id')} movie ${index + 1}`, container_extension: 'mp4' })) : []
    return new Response(JSON.stringify(data))
  }))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(250) }
  const change = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  const account = validateSource({ kind: 'xtream', url: 'https://provider.example', username: 'demo', password: 'demo' })
  await change('source-kind', 'xtream'); el<HTMLInputElement>('source-url').value = account.url
  el<HTMLInputElement>('username').value = 'demo'; el<HTMLInputElement>('password').value = 'demo'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-settings'); await click('settings-home')
  expect([...el<HTMLSelectElement>('layout-category').options].map(option => option.text)).toEqual(['Drama · 1', 'Drama · 2'])
  await change('layout-category', '1'); el<HTMLInputElement>('layout-title').value = 'Evening collection'; await click('layout-add')
  await click('layout-save'); await click('settings-back')
  const config = new TVLibrary(localStorage, account).homeLayout!
  expect(config.categories[0]).toEqual({ id: 'category-0', kind: 'movie', title: 'Evening collection', categoryId: '2' })
  expect(el('home-rows').querySelectorAll('[data-row="category-0"] .channel')).toHaveLength(0)
  expect(el('home-rows').querySelector('[data-row="category-0"]')?.textContent).toContain('No titles loaded')
  await change('watched-filter', 'watched'); await change('language-filter', 'FR')
  el('home-rows').querySelector<HTMLButtonElement>('[data-row="category-0"] [data-home-action="open"]')!.click(); await vi.advanceTimersByTimeAsync(250)
  expect(el('section-title').textContent).toBe('Evening collection'); expect(el('result-count').textContent).toContain('20 titles')
  expect(el('channels').textContent).toContain('Category 2 movie 20'); expect(el('channels').textContent).not.toContain('Category 1 movie')
  expect(el<HTMLSelectElement>('watched-filter').value).toBe('all'); expect(el<HTMLSelectElement>('language-filter').value).toBe('')
  await click('nav-home'); expect(el('home-rows').querySelectorAll('[data-row="category-0"] .channel')).toHaveLength(12)
  await click('nav-movie'); await click('change-source'); await click('profile-new'); el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'
  await click('connect'); expect(el('home-rows').querySelector('[data-row="category-0"]')).toBeNull()
  await click('nav-settings'); await click('settings-home'); await click('layout-add'); await click('layout-save'); await click('settings-back')
  expect(el('home-rows').querySelector('[data-row="category-0"]')?.textContent).toContain('Playlist movie')
  el('home-rows').querySelector<HTMLButtonElement>('[data-row="category-0"] [data-home-action="open"]')!.click(); await vi.advanceTimersByTimeAsync(250)
  expect(el<HTMLSelectElement>('group').value).toBe('Drama'); expect(el('result-count').textContent).toContain('1 title')
  playlistGroup = 'Comedy'; await click('refresh-catalog')
  expect(el('home-rows').querySelector('[data-row="category-0"]')?.textContent).toContain('No titles loaded')
  el('home-rows').querySelector<HTMLButtonElement>('[data-row="category-0"] [data-home-action="open"]')!.click(); await vi.advanceTimersByTimeAsync(250)
  expect(el<HTMLSelectElement>('group').value).toBe('Drama'); expect(el('result-count').textContent).toContain('0 titles')
  expect(el('channels').textContent).not.toContain('Playlist movie')
  expect(new TVLibrary(localStorage, account).homeLayout).toEqual(config)
  vi.clearAllTimers()
})

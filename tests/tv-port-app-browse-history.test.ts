// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('restores category IDs, search, page and focus across section/source visits, and handles a smaller or removed category', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let smaller = false, removed = false, y = 0
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y)
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const params = new URL(address).searchParams, action = params.get('action'), id = params.get('category_id')
    if (!action) return new Response('#EXTM3U\n#EXTINF:-1 tvg-type="movie",Other source film\nhttps://other.example/1.mp4\n')
    const data = action === 'get_live_categories' ? []
      : action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'Drama' }, ...removed ? [] : [{ category_id: '2', category_name: 'Drama' }]]
      : action === 'get_series_categories' ? [{ category_id: '3', category_name: 'Shows' }]
      : action === 'get_vod_streams' ? Array.from({ length: smaller && id === '2' ? 10 : 80 }, (_, i) => ({ stream_id: `${id}${String(i + 1).padStart(3, '0')}`, name: `Category ${id} Film ${String(i + 1).padStart(2, '0')}`, container_extension: 'mp4' }))
      : action === 'get_series' ? Array.from({ length: 70 }, (_, i) => ({ series_id: String(i + 1), name: `Saga ${i + 1}` })) : { info: { plot: 'Details' } }
    return new Response(JSON.stringify(data))
  }))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).focus(); el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const change = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500) }
  const search = async (text: string) => { el<HTMLInputElement>('search').focus(); el<HTMLInputElement>('search').value = text; el('search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(500) }
  const jump = async (page: number) => { el<HTMLInputElement>('page-jump').value = String(page); await click('page-go') }
  const cards = () => [...el('channels').querySelectorAll<HTMLButtonElement>('button')]
  const focusName = () => document.activeElement?.querySelector('.card-title')?.textContent
  await change('source-kind', 'xtream'); el<HTMLInputElement>('source-url').value = 'https://provider.example'
  el<HTMLInputElement>('source-name').value = 'Original'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-movie')
  el('category-list').querySelectorAll<HTMLButtonElement>('button')[1].click(); await vi.advanceTimersByTimeAsync(500)
  await search('Film'); await jump(2); cards()[4].focus(); y = 900; el('channels').scrollTop = 40; el('category-sidebar').scrollTop = 65
  await click('nav-series'); await search('Saga'); await jump(3); cards()[6].focus(); y = 1100
  await click('nav-home'); await click('nav-movie')
  expect(el('section-title').textContent).toBe('Drama'); expect(el<HTMLInputElement>('search').value).toBe('Film')
  expect(el('page-label').textContent).toBe('Page 2 of 4'); expect(focusName()).toBe('Category 2 Film 29')
  expect(scroll).toHaveBeenLastCalledWith(0, 900); expect(el('channels').scrollTop).toBe(40); expect(el('category-sidebar').scrollTop).toBe(65)
  cards()[4].click(); await vi.advanceTimersByTimeAsync(500); await click('detail-back')
  expect(el('page-label').textContent).toBe('Page 2 of 4'); expect(focusName()).toBe('Category 2 Film 29')
  await click('nav-series'); expect(el('page-label').textContent).toBe('Page 3 of 3'); expect(focusName()).toBe('Saga 55')
  await click('view-favorites'); expect(el<HTMLInputElement>('search').value).toBe(''); expect(el('page-label').textContent).toBe('Page 1 of 1')
  await click('nav-movie'); expect(focusName()).toBe('Category 2 Film 29')
  await click('change-source'); await click('profile-new'); el<HTMLInputElement>('source-url').value = 'https://other.example/list.m3u'
  await click('connect'); await click('nav-movie'); expect(el<HTMLInputElement>('search').value).toBe(''); expect(el('channels').textContent).toContain('Other source film')
  await click('change-source'); el('profile-list').querySelector<HTMLButtonElement>('.profile-open')!.click(); await vi.advanceTimersByTimeAsync(500)
  await click('nav-movie'); expect(el('page-label').textContent).toBe('Page 2 of 4'); expect(focusName()).toBe('Category 2 Film 29')
  smaller = true; await click('refresh-catalog'); await click('nav-movie')
  expect(el('page-label').textContent).toBe('Page 1 of 1'); expect(focusName()).toBe('Category 2 Film 01')
  removed = true; await click('refresh-catalog'); await click('nav-movie')
  expect(cards()).toHaveLength(0); expect(el('notice').textContent).toContain('previous category is no longer available')
  await click('categories-back'); expect(el<HTMLInputElement>('search').value).toBe(''); expect(el('channels').textContent).toContain('Category 1 Film')
  await click('nav-series'); await click('nav-movie'); expect(el('section-title').textContent).toBe('Movies')
  expect(el('channels').textContent).toContain('Category 1 Film'); expect(el('notice').textContent).not.toContain('no longer available')
  // Search text/positions are session memory, not the remembered source's persistent library.
  expect([...Array(localStorage.length)].map((_, i) => localStorage.getItem(localStorage.key(i)!)).join('')).not.toContain('"query"')
  vi.clearAllTimers()
})

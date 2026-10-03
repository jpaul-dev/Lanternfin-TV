// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('browses related movies/series, restores detail history and season pages, and ignores abandoned loads', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let late: ((response: Response) => void) | undefined, delayDetails = false
  const fetch = vi.fn(async (url: string) => {
    const params = new URL(url).searchParams, action = params.get('action')
    if (delayDetails && action === 'get_vod_info' && params.get('vod_id') === '2') return new Promise<Response>(resolve => { late = resolve })
    const data = action === 'get_live_categories' ? []
      : action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'Drama' }, { category_id: '2', category_name: 'Drama' }]
      : action === 'get_series_categories' ? [{ category_id: '3', category_name: 'Series' }]
      : action === 'get_vod_streams' ? params.get('category_id') === '2' ? [{ stream_id: 99, name: 'Different category', rating: 10 }] : [{ stream_id: 1, name: 'First movie', rating: 6.1, year: 2020 }, { stream_id: 2, name: 'Second movie', rating: 9.3, year: 2021 }, { stream_id: 3, name: 'Third movie', rating: 8.1, year: 2022 }]
      : action === 'get_series' ? [{ series_id: 10, name: 'First series' }, { series_id: 11, name: 'Second series' }]
      : action === 'get_series_info' ? { info: { plot: 'Series details' }, episodes: { 1: [{ id: 100, episode_num: 1, title: 'Opening' }], 2: Array.from({ length: 30 }, (_, i) => ({ id: 200 + i, episode_num: i + 1, title: `Later ${i + 1}` })) } }
      : { info: { plot: 'Movie details' } }
    return new Response(JSON.stringify(data))
  }); vi.stubGlobal('fetch', fetch)
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const change = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  const card = (root: string, name: string) => [...el(root).querySelectorAll<HTMLButtonElement>('button')].find(button => button.querySelector('.card-title')?.textContent === name)!
  const related = () => [...el('detail-related-rail').querySelectorAll('.card-title')].map(node => node.textContent)
  await change('source-kind', 'xtream'); el<HTMLInputElement>('source-url').value = 'https://provider.example'
  el<HTMLInputElement>('username').value = 'demo'; el<HTMLInputElement>('password').value = 'demo'; await click('connect')
  await click('nav-movie'); card('channels', 'First movie').click(); await vi.advanceTimersByTimeAsync(500)
  expect(el('detail-title').textContent).toBe('First movie'); expect(el('detail-meta').textContent).toContain('2020')
  expect(related()).toEqual(['Second movie', 'Third movie']); expect(el('detail-related-rail').textContent).toContain('9.3 / 10')
  card('detail-related-rail', 'Second movie').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('detail-title').textContent).toBe('Second movie'); expect(el('detail-back').textContent).toContain('previous title')
  expect(related()).toEqual(['Third movie', 'First movie'])
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await vi.advanceTimersByTimeAsync(0)
  expect(el('detail-title').textContent).toBe('First movie'); expect(document.activeElement).toBe(card('detail-related-rail', 'Second movie'))
  await click('detail-back'); expect(el('catalog').hidden).toBe(false)
  await click('nav-series'); card('channels', 'First series').click(); await vi.advanceTimersByTimeAsync(0)
  await change('detail-season', 'Season 2'); await click('episode-next'); expect(el('episode-page').textContent).toBe('Page 2 of 2')
  // Hold-OK actions on a related card use the same detail-history path as a normal press.
  card('detail-related-rail', 'Second series').focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); await click('card-menu-play')
  expect(el('detail-title').textContent).toBe('Second series')
  await click('detail-back'); expect(el('detail-title').textContent).toBe('First series')
  expect(el<HTMLSelectElement>('detail-season').value).toBe('Season 2'); expect(el('episode-page').textContent).toBe('Page 2 of 2')
  expect(document.activeElement).toBe(card('detail-related-rail', 'Second series'))
  await click('nav-movie'); card('channels', 'First movie').click(); await vi.advanceTimersByTimeAsync(0)
  delayDetails = true; card('detail-related-rail', 'Second movie').click(); await vi.advanceTimersByTimeAsync(0)
  await click('nav-home'); late!(new Response(JSON.stringify({ info: { plot: 'Stale description' } }))); await vi.advanceTimersByTimeAsync(0)
  expect(el('catalog').hidden).toBe(false); expect(el('detail').hidden).toBe(true)
  delayDetails = false; await click('nav-movie'); card('channels', 'First movie').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('detail-back').textContent).toContain('Back to library'); expect(el('detail-description').textContent).toBe('Movie details')
  vi.clearAllTimers()
})

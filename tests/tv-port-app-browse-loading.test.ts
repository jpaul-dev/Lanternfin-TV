// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('waits for a saved title during partial loading and never steals focus after new input or navigation', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let delayed = false
  const releases: Array<() => void> = []
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const params = new URL(address).searchParams, action = params.get('action'), category = params.get('category_id')
    const data = action === 'get_live_categories' ? [] : action === 'get_vod_categories' ? [{ category_id: '1', category_name: 'First' }, { category_id: '2', category_name: 'Second' }]
      : action === 'get_series_categories' ? [{ category_id: '3', category_name: 'Shows' }]
      : action === 'get_vod_streams' ? Array.from({ length: 30 }, (_, i) => { const id = (category === '2' ? 30 : 0) + i + 1; return { stream_id: String(id), name: `Movie ${id}`, container_extension: 'mp4' } })
      : action === 'get_series' ? [{ series_id: '1', name: 'Series example' }] : {}
    if (delayed && action === 'get_vod_streams' && category === '2') return new Promise<Response>(resolve => releases.push(() => resolve(new Response(JSON.stringify(data)))))
    return new Response(JSON.stringify(data))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const cards = () => [...el('channels').querySelectorAll<HTMLButtonElement>('button')]
  const release = async () => { delayed = false; releases.splice(0).forEach(done => done()); await vi.advanceTimersByTimeAsync(1000) }
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://provider.example'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); await click('nav-movie'); el<HTMLInputElement>('page-jump').value = '3'; await click('page-go'); cards()[7].focus()
  delayed = true; await click('refresh-catalog'); await click('nav-movie')
  expect(el('index-status').textContent).toContain('Loading'); expect(el('page-label').textContent).toBe('Page 2 of 2')
  await release(); expect(el('page-label').textContent).toBe('Page 3 of 3'); expect(document.activeElement?.querySelector('.card-title')?.textContent).toBe('Movie 56')
  delayed = true; await click('refresh-catalog'); await click('nav-movie')
  el<HTMLInputElement>('search').focus(); el<HTMLInputElement>('search').value = 'Movie 1'; el('search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(500)
  await release(); expect(el('page-label').textContent).toBe('Page 1 of 1'); expect(document.activeElement?.id).toBe('search'); expect(el<HTMLInputElement>('search').value).toBe('Movie 1')
  delayed = true; await click('refresh-catalog'); await click('nav-movie')
  el('category-list').querySelectorAll<HTMLButtonElement>('button')[1].click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('cancel-category').hidden).toBe(false)
  await click('nav-series'); await release()
  expect(el('section-title').textContent).toBe('Series'); expect(el('channels').textContent).toContain('Series example'); expect(el('channels').textContent).not.toContain('Movie')
  expect(el('cancel-category').hidden).toBe(true)
  vi.clearAllTimers()
})

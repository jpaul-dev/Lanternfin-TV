// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('browses and restores distant playlist/provider categories without building a control for every category', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  const categoryName = (i: number) => `Category ${String(i).padStart(4, '0')}`
  let removed = false
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const url = new URL(address), action = url.searchParams.get('action'), id = url.searchParams.get('category_id')
    if (action) return new Response(JSON.stringify(action === 'get_live_categories' || action === 'get_series_categories' ? [] : action === 'get_vod_categories' ? Array.from({ length: 250 }, (_, i) => ({ category_id: String(i), category_name: i > 240 ? 'Same name' : categoryName(i) })) : action === 'get_vod_streams' ? [{ stream_id: Number(id) + 1, name: `Provider title ${id}`, container_extension: 'mp4' }] : {}))
    return new Response('#EXTM3U\n' + Array.from({ length: removed ? 100 : 1000 }, (_, i) => `#EXTINF:-1 tvg-type="movie" group-title="${categoryName(i)}",Movie ${i}\nhttps://example.com/${i}.mp4\n`).join(''))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const query = async (value: string) => { el<HTMLInputElement>('category-search').focus(); el<HTMLInputElement>('category-search').value = value; el('category-search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(250) }
  const buttons = () => [...el('category-list').querySelectorAll<HTMLButtonElement>('button')]
  el<HTMLInputElement>('source-url').value = 'https://example.com/categories.m3u'; await click('connect'); await click('nav-movie')
  expect(buttons()).toHaveLength(16); expect(el<HTMLSelectElement>('group').options.length).toBeLessThanOrEqual(2)
  expect(el('category-status').textContent).toBe('1,000 categories'); await query('0999'); expect(buttons()).toHaveLength(1)
  buttons()[0].focus(); buttons()[0].click(); await vi.advanceTimersByTimeAsync(500)
  expect(el('channels').textContent).toContain('Movie 999'); expect(el<HTMLSelectElement>('group').value).toBe('Category 0999')
  await click('nav-home'); await click('nav-movie')
  expect(el<HTMLInputElement>('category-search').value).toBe('0999'); expect(document.activeElement?.dataset.category).toBe('Category 0999')
  expect(buttons()[0].getAttribute('aria-pressed')).toBe('true')
  await query(''); await click('category-next'); expect(el('category-page').textContent).toBe('2 / 63')
  el('category-search').focus()
  await click('nav-home'); await click('nav-movie'); expect(el('category-page').textContent).toBe('2 / 63')
  expect(document.activeElement?.id).toBe('category-search')
  hidden = true; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0)
  hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(500)
  buttons()[1].click(); await vi.advanceTimersByTimeAsync(500); expect(el('channels').textContent).toContain('Movie 17')
  await query('0999'); buttons()[0].click(); await vi.advanceTimersByTimeAsync(500)
  removed = true; await click('refresh-catalog'); await click('nav-movie')
  expect(el<HTMLSelectElement>('group').value).toBe('Category 0999'); expect(el('channels').children).toHaveLength(0)
  await click('categories-back'); expect(el('category-page').textContent).toBe('1 / 7'); expect(el('channels').textContent).toContain('Movie 0')
  await click('change-source'); el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://provider.example'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); await click('nav-movie'); await query('Same name')
  expect(buttons()).toHaveLength(9); expect(new Set(buttons().map(button => button.dataset.category)).size).toBe(9)
  buttons()[7].focus(); buttons()[7].click(); await vi.advanceTimersByTimeAsync(500)
  expect(el('channels').textContent).toContain('Provider title 248'); expect(buttons()[7].getAttribute('aria-pressed')).toBe('true')
  await click('nav-home'); await click('nav-movie'); expect(el<HTMLInputElement>('category-search').value).toBe('Same name')
  expect(el('channels').textContent).toContain('Provider title 248'); expect(buttons().find(button => button.dataset.category === '248')?.getAttribute('aria-pressed')).toBe('true')
  vi.clearAllTimers()
})

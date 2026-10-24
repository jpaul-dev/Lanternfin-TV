// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'
import { validateSource } from '../tv-app/catalog'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('uses Xtream category IDs even when names duplicate, applies select mode, and isolates the next source', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const url = new URL(address), action = url.searchParams.get('action'), category = url.searchParams.get('category_id')
    const data = action?.endsWith('_categories') ? [{ category_id: '1', category_name: 'Same name' }, { category_id: '2', category_name: 'Same name' }]
      : action === 'get_live_streams' || action === 'get_vod_streams' ? ['1','2'].filter(id => !category || category === id).map(id => ({ stream_id: id, category_id: id, name: `${action === 'get_live_streams' ? 'Channel' : 'Movie'} ${id}`, container_extension: 'mp4' }))
      : action === 'get_series' ? [] : {}
    if (action === 'get_live_streams' && Array.isArray(data)) data.push({ stream_id: '3', category_id: category || '1', name: 'Shared channel', container_extension: 'mp4' } as never)
    return new Response(JSON.stringify(data))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const choice = async (selector: string) => { document.querySelector<HTMLElement>(selector)!.click(); await vi.advanceTimersByTimeAsync(500) }
  const source = validateSource({ kind: 'xtream', url: 'https://provider.test', username: 'demo', password: 'demo' })
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = source.url; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-live'); expect(el('schedule-rows').textContent).toContain('Channel 1'); expect(el('schedule-rows').textContent).toContain('Channel 2')
  await click('nav-settings'); await click('settings-categories'); await choice('#visibility [data-mode="select"]'); await choice('#visibility-list [data-category="2"]'); await click('visibility-save')
  await click('nav-live'); expect(el('schedule-rows').textContent).not.toContain('Channel 1'); expect(el('schedule-rows').textContent).toContain('Channel 2'); expect(el('schedule-rows').textContent).toContain('Shared channel')
  await click('schedule-category'); expect(el('schedule-category-list').querySelectorAll('[data-category]')).toHaveLength(1)
  await choice('#schedule-category-list [data-category="2"]'); expect(el('schedule-rows').textContent).toContain('Channel 2')
  await click('nav-movie'); expect(el('channels').textContent).toContain('Movie 1'); expect(el('channels').textContent).toContain('Movie 2')
  expect(new TVLibrary(localStorage, source).categoryRules.live).toEqual({ mode: 'select', ids: ['2'] })
  await click('change-source'); await click('profile-new'); el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://other.test'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'; el<HTMLInputElement>('remember').checked = false
  await click('connect'); await click('nav-live'); expect(el('schedule-rows').textContent).toContain('Channel 1'); expect(el('schedule-rows').textContent).toContain('Channel 2')
  vi.clearAllTimers()
})

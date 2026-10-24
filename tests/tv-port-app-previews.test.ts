// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('reuses movie banner details, still loads series episodes, and clears enrichment on source changes', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear(); sessionStorage.clear()
  const requested: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const url = new URL(address), action = url.searchParams.get('action') || ''; requested.push(action)
    const info = { plot: `${url.hostname} ${action} synopsis`, backdrop_path: [`https://images.example/${url.hostname}/${action}.jpg`] }
    const data = action.endsWith('_categories') ? [{ category_id: '1', category_name: 'Demo' }]
      : action === 'get_vod_streams' ? [{ stream_id: '1', name: 'Movie', container_extension: 'mp4' }]
      : action === 'get_series' ? [{ series_id: '2', name: 'Series' }]
      : action === 'get_vod_info' ? { info }
      : action === 'get_series_info' ? { info, episodes: { 1: [{ id: '21', season: 1, episode_num: 1, title: 'First episode' }] } } : []
    return new Response(JSON.stringify(data))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(1000) }
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://first.example'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); expect(el('hero-description').textContent).toBe('first.example get_vod_info synopsis')
  expect(requested.filter(action => action === 'get_vod_info')).toHaveLength(1)
  await click('hero-play'); expect(el('detail-title').textContent).toBe('Movie'); expect(el('detail-description').textContent).toBe('first.example get_vod_info synopsis')
  expect(requested.filter(action => action === 'get_vod_info')).toHaveLength(1)
  await click('nav-home'); el('home-rows').querySelector<HTMLButtonElement>('[data-kind="series"]')!.focus(); await vi.advanceTimersByTimeAsync(500)
  expect(el('hero-description').textContent).toBe('first.example get_series_info synopsis'); expect(requested.filter(action => action === 'get_series_info')).toHaveLength(1)
  await click('hero-play'); expect(el('episode-grid').textContent).toContain('First episode'); expect(requested.filter(action => action === 'get_series_info')).toHaveLength(2)
  await click('nav-settings'); await click('settings-source'); await click('profile-new')
  el<HTMLSelectElement>('source-kind').value = 'xtream'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://second.example'; el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'demo'
  await click('connect'); expect(el('hero-description').textContent).toBe('second.example get_vod_info synopsis'); expect(requested.filter(action => action === 'get_vod_info')).toHaveLength(2)
  vi.clearAllTimers()
})

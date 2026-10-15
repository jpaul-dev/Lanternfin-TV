// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { readProfiles, rememberProfile } from '../tv-app/profiles'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('applies guide corrections immediately, preserves them on refresh, and isolates source and global settings', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const now = Date.now(), source = { kind: 'xtream' as const, url: 'https://provider.example/', username: 'test', password: 'test' }
  rememberProfile(localStorage, source, 'Corrected guide', undefined, { guideOffset: 60 })
  vi.stubGlobal('fetch', vi.fn(async (address: string) => {
    const action = new URL(address).searchParams.get('action') || ''
    return new Response(JSON.stringify(action === 'get_live_categories' ? [{ category_id: '1', category_name: 'News' }] : action === 'get_live_streams' ? [{ stream_id: '1', name: 'News channel' }] : action.includes('data_table') ? { epg_listings: [{ start_timestamp: (now - 70 * 60000) / 1000, stop_timestamp: (now - 10 * 60000) / 1000, title: 'Current programme' }] } : []))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const set = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500) }
  expect(el<HTMLSelectElement>('guide-offset').value).toBe('60')
  await click('connect'); await click('nav-live'); await click('schedule-more'); await click('schedule-list'); expect(el('guide-status').textContent).toContain('On now'); expect(el('guide-programmes').textContent).toContain('Current programme')
  await click('guide-watch'); expect(el('playing-programme').textContent).toContain('Current programme'); await click('stop')
  await click('nav-settings'); expect(el<HTMLSelectElement>('source-guide-offset').value).toBe('60'); await set('pref-accent', 'blue'); await set('source-guide-offset', '0')
  expect(el<HTMLSelectElement>('pref-accent').value).toBe('blue'); expect(el('settings-note').textContent).toBe('Guide correction saved for this source.')
  await click('nav-live'); await click('schedule-more'); await click('schedule-list'); expect(el('guide-status').textContent).not.toContain('On now')
  await click('nav-settings'); await set('source-guide-offset', '60'); await click('settings-refresh'); await click('nav-live'); await click('schedule-more'); await click('schedule-list'); expect(el('guide-status').textContent).toContain('On now')
  expect(readProfiles(localStorage)[0].guideOffset).toBe(60)
  await click('nav-settings'); await click('settings-source'); await click('profile-new'); expect(el<HTMLSelectElement>('guide-offset').value).toBe('0')
  el<HTMLInputElement>('source-url').value = 'https://session.example/'; await set('source-kind', 'xtream'); el<HTMLInputElement>('username').value = el<HTMLInputElement>('password').value = 'test'
  await click('connect'); await click('nav-settings'); await set('source-guide-offset', '-30'); expect(el('settings-note').textContent).toContain('this session')
  await click('settings-refresh'); await click('nav-settings'); expect(el<HTMLSelectElement>('source-guide-offset').value).toBe('-30'); expect(readProfiles(localStorage)).toHaveLength(1)
  await click('settings-source'); await click('profile-new')
  el<HTMLInputElement>('source-url').value = 'https://other.example/stream.mp4'; await set('source-kind', 'direct'); await click('connect'); await click('nav-settings'); expect(el<HTMLSelectElement>('source-guide-offset').disabled).toBe(true)
  expect(readProfiles(localStorage)[0].guideOffset).toBe(60); vi.clearAllTimers()
})

// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { readProfiles } from '../tv-app/profiles'
import { readPreferences, savePreferences, DEFAULTS } from '../tv-app/preferences'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('switches remembered and temporary source colors, preserves overrides on refresh, and uses the app default when removed', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear(); sessionStorage.clear()
  savePreferences(localStorage, { ...DEFAULTS, accent: 'blue' })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1,Test\nhttps://example.test/test.mp4')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const wait = () => vi.advanceTimersByTimeAsync(500), click = async (id: string) => { el(id).click(); await wait() }
  const choose = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await wait() }
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; el<HTMLInputElement>('remember').checked = true
  await choose('profile-accent', 'cyan'); expect(document.documentElement.dataset.accent).toBe('blue')
  await click('connect'); expect(document.documentElement.dataset.accent).toBe('cyan'); expect(readProfiles(localStorage)[0].accent).toBe('cyan')
  await click('nav-settings'); await choose('pref-accent', 'random'); const mode = readPreferences(localStorage).accent
  expect(mode).toBe('random'); expect(document.documentElement.dataset.accent).toBe('cyan'); expect(el('accent-note').textContent).toContain('overrides')
  await choose('source-accent', 'gold'); expect(readProfiles(localStorage)[0].accent).toBe('gold')
  await click('settings-refresh'); expect(document.documentElement.dataset.accent).toBe('gold')
  await click('nav-settings'); await choose('source-accent', '')
  const rolled = document.documentElement.dataset.accent; expect(readProfiles(localStorage)[0].accent).toBeUndefined()
  await choose('pref-scale', '1.15'); expect(document.documentElement.dataset.accent).toBe(rolled)
  await click('settings-source'); await click('profile-new'); expect(el<HTMLSelectElement>('profile-accent').value).toBe('')
  el<HTMLInputElement>('source-url').value = 'https://example.test/temporary.m3u'; await choose('profile-accent', 'rose'); await click('connect')
  expect(document.documentElement.dataset.accent).toBe('rose'); expect(readProfiles(localStorage)).toHaveLength(1)
  await click('nav-settings'); await choose('source-accent', 'white'); expect(el('settings-note').textContent).toContain('this session')
  expect(readProfiles(localStorage)).toHaveLength(1)
  await click('settings-source'); el('profile-list').querySelector<HTMLButtonElement>('.profile-open')!.click(); await wait()
  expect(document.documentElement.dataset.accent).toBe(rolled)
  window.dispatchEvent(new Event('pagehide')); vi.clearAllTimers()
})

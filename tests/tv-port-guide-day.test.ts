// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('refreshes guide days at midnight, preserves a selected day and resets an expired day', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-03T23:59:50Z')); vi.stubGlobal('__TV_TARGET__', 'browser')
  localStorage.clear(); document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1,News\nhttps://example.test/live.m3u8')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; el('connect').click(); await vi.advanceTimersByTimeAsync(0)
  el('nav-settings').click(); const clock = el<HTMLSelectElement>('pref-clock'); clock.value = '0'; clock.dispatchEvent(new Event('change'))
  el('nav-live').click(); await vi.advanceTimersByTimeAsync(0); el('schedule-more').click(); el('schedule-list').click(); await vi.advanceTimersByTimeAsync(0)
  const picker = el<HTMLSelectElement>('guide-day'), today = String(Date.parse('2026-10-03T00:00:00Z'))
  picker.value = today; picker.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(30000)
  expect(picker.value).toBe(today)
  expect([...picker.options].find(option => option.textContent?.startsWith('Today'))?.value).toBe(String(Date.parse('2026-10-04T00:00:00Z')))
  picker.value = picker.options[1].value; picker.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0)
  vi.setSystemTime(Date.now() + 86400000); await vi.advanceTimersByTimeAsync(30000)
  expect(picker.value).toBe('now')
})

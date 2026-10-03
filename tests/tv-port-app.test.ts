// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('runs source loading, favorites, resume, failed-refresh recovery and forgetting through the actual UI', async () => {
  vi.useFakeTimers(); localStorage.clear()
  vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  document.documentElement.innerHTML = readFileSync(resolve('tv-app/index.html'), 'utf8')
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const kind = el<HTMLSelectElement>('source-kind'); kind.value = 'direct'; kind.dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.com/movie.mp4'
  el<HTMLInputElement>('remember').checked = true
  await click('connect'); expect(el('catalog').hidden).toBe(false)
  ;(el('channels').querySelector('button') as HTMLButtonElement).click()
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'duration', { value: 600 })
  video.currentTime = 120; video.dispatchEvent(new Event('playing'))
  await click('favorite'); expect(el('favorite').getAttribute('aria-pressed')).toBe('true')
  await click('stop'); await click('view-favorites')
  expect(el('channels').querySelectorAll('button')).toHaveLength(1)
  ;(el('channels').querySelector('button') as HTMLButtonElement).click()
  expect(el('resume').hidden).toBe(false); expect(el('resume-description').textContent).toContain('2:00')
  await click('resume-start'); video.currentTime = 0; video.dispatchEvent(new Event('playing'))
  await click('favorite'); await click('stop')
  expect(el('channels').querySelectorAll('button')).toHaveLength(0)
  await click('view-all'); await click('change-source')
  kind.value = 'playlist'; kind.dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.com/broken.m3u'
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private provider detail')))
  await click('connect')
  expect(el('notice').textContent).toContain('Cannot reach'); expect(el('notice').textContent).not.toContain('private provider detail')
  await click('return-catalog'); expect(el('channels').querySelectorAll('button')).toHaveLength(1)
  // Refresh uses the loaded source, not an unsuccessful edit still in the form.
  await click('refresh-catalog'); expect(el('catalog').hidden).toBe(false); expect(kind.value).toBe('direct')
  await click('change-source'); await click('forget')
  expect(localStorage.length).toBe(0); expect(el('return-catalog').hidden).toBe(true)
  vi.clearAllTimers()
})

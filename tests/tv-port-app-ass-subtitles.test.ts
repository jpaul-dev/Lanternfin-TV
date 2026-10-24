// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('renders ASS text safely during playback, retains controls and keeps working captions after an invalid replacement', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const choose = (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')) }
  choose('source-kind', 'direct'); el<HTMLInputElement>('source-url').value = 'https://example.com/movie.mp4'
  await click('connect'); (el('channels').querySelector('button') as HTMLButtonElement).click()
  const video = document.querySelector('video')!, embedded = { label: 'English', language: 'en', kind: 'subtitles', mode: 'showing' }
  Object.defineProperty(video, 'duration', { value: 600 }); Object.defineProperty(video, 'textTracks', { value: [embedded] })
  video.currentTime = 5; video.dispatchEvent(new Event('playing'))
  await click('tracks-open'); choose('subtitle-track', '0')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Start, End, Text\nDialogue: 0:00:04.00,0:00:06.00,<img src=x> {\\i1}First &amp; literal\nDialogue: 0:00:07.00,0:00:09.00,{\\p1}m 0 0 l 10 10{\\p0}Second')))
  await click('subtitle-add'); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/test.ass'; await click('subtitle-load')
  expect(embedded.mode).toBe('disabled'); expect(el<HTMLSelectElement>('subtitle-track').value).toBe('external-file')
  expect(el('external-subtitles').textContent).toBe('<img src=x> First &amp; literal')
  expect(el('external-subtitles').children).toHaveLength(0)
  choose('subtitle-size', '1.5'); expect(el('external-subtitles').style.fontSize).toBe('6vh')
  choose('subtitle-delay', '2'); expect(el('external-subtitles').hidden).toBe(true)
  video.currentTime = 7; await vi.advanceTimersByTimeAsync(250); expect(el('external-subtitles').textContent).toContain('First')
  choose('subtitle-delay', '0'); expect(el('external-subtitles').textContent).toBe('Second')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[Script Info]\nScriptType: v4.00+\n[Events]\nDialogue: invalid')))
  await click('subtitle-add'); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/bad.ass'; await click('subtitle-load')
  expect(el('subtitle-load-status').textContent).toContain('valid timestamps')
  expect(el('external-subtitles').textContent).toBe('Second'); expect(el('external-subtitles').style.fontSize).toBe('6vh')
  await click('subtitle-cancel'); choose('subtitle-track', '0')
  expect(embedded.mode).toBe('showing'); expect(el('external-subtitles').hidden).toBe(true)
  choose('subtitle-track', 'external-file'); expect(embedded.mode).toBe('disabled'); expect(el('external-subtitles').textContent).toBe('Second')
  await click('tracks-close'); await click('stop'); expect(el('external-subtitles').textContent).toBe('')
  vi.clearAllTimers()
})

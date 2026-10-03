// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('loads subtitles in playback, switches tracks, adjusts captions, cancels edits and clears on stop', async () => {
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
  await click('tracks-open'); choose('subtitle-track', '0'); expect(embedded.mode).toBe('showing')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('WEBVTT\n\n00:04.000 --> 00:06.000\n<img src=x> First\n\n00:07.000 --> 00:09.000\nSecond')))
  await click('subtitle-add'); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/test.vtt'
  const cursor = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); document.dispatchEvent(cursor)
  expect(cursor.defaultPrevented).toBe(false); expect(document.activeElement).toBe(el('subtitle-url'))
  await click('subtitle-load')
  expect(embedded.mode).toBe('disabled'); expect(el<HTMLSelectElement>('subtitle-track').value).toBe('external-file')
  expect(el('external-subtitles').textContent).toBe('<img src=x> First'); expect(el('external-subtitles').querySelector('img')).toBeNull()
  expect(el<HTMLInputElement>('subtitle-url').value).toBe(''); expect(el<HTMLSelectElement>('subtitle-size').disabled).toBe(false)
  choose('subtitle-size', '1.5'); expect(el('external-subtitles').style.fontSize).toBe('6vh')
  choose('subtitle-delay', '2'); expect(el('external-subtitles').hidden).toBe(true)
  video.currentTime = 7; await vi.advanceTimersByTimeAsync(250); expect(el('external-subtitles').textContent).toContain('First')
  choose('subtitle-delay', '0'); expect(el('external-subtitles').textContent).toBe('Second')
  choose('subtitle-track', 'off'); expect(el('external-subtitles').hidden).toBe(true)
  choose('subtitle-track', '0'); expect(embedded.mode).toBe('showing')
  choose('subtitle-track', 'external-file'); expect(embedded.mode).toBe('disabled'); expect(el('external-subtitles').textContent).toBe('Second')
  // A failed replacement keeps the working subtitle file and size/timing settings.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private failure', { status: 403 })))
  await click('subtitle-add'); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/denied.vtt'; await click('subtitle-load')
  expect(el('subtitle-load-status').textContent).toContain('did not return'); expect(el('external-subtitles').textContent).toBe('Second')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(el('subtitle-editor').hidden).toBe(true); expect(el('track-menu').hidden).toBe(false)
  expect(el<HTMLInputElement>('subtitle-url').value).toBe('')
  await click('subtitle-add'); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/pending.vtt'
  // Closing the menu aborts a pending request and clears transient addresses.
  let requestSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => { requestSignal = init.signal!; return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('secret')))) }))
  await click('subtitle-load'); await click('tracks-close')
  expect(requestSignal?.aborted).toBe(true); expect(el<HTMLInputElement>('subtitle-url').value).toBe('')
  expect(el('external-subtitles').textContent).toBe('Second')
  await click('stop'); expect(el('external-subtitles').textContent).toBe(''); expect(el('external-subtitles').hidden).toBe(true)
  // Restarting this or another stream does not reuse a subtitle timed for the previous playback session.
  ;(el('channels').querySelector('button') as HTMLButtonElement).click(); video.dispatchEvent(new Event('playing')); await click('tracks-open')
  expect(el<HTMLSelectElement>('subtitle-track').querySelector('[value="external-file"]')).toBeNull()
  vi.clearAllTimers()
})

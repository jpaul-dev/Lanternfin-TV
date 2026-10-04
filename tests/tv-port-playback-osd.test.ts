// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { canSeek, scrubOSD } from '../tv-app/playback-osd'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('rejects live, invalid and unavailable timelines before sending seek commands', () => {
  const timeline = { position: 10, duration: 600 }
  expect(canSeek(timeline, false, 'playing')).toBe(true)
  expect(canSeek(timeline, false, 'paused')).toBe(true)
  expect(canSeek(timeline, true, 'playing')).toBe(false)
  expect(canSeek(timeline, false, 'loading')).toBe(false)
  expect(canSeek({ ...timeline, duration: Infinity }, false, 'playing')).toBe(false)
  expect(canSeek({ ...timeline, position: NaN }, false, 'playing')).toBe(false)
})

it('keeps feedback on the actual timeline, extends its deadline, and clears invalid values', async () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="scrub" hidden><span data-scrub-position></span><span data-scrub-remaining></span><strong data-scrub-delta></strong><progress></progress></div>'
  const root = document.getElementById('scrub')!, hud = scrubOSD(root)
  hud.show({ position: 120, duration: 600 }, 10)
  expect(root.textContent).toContain('2:00'); expect(root.textContent).toContain('8:00 remaining')
  await vi.advanceTimersByTimeAsync(2000)
  hud.show({ position: 120, duration: 600 }, -10)
  await vi.advanceTimersByTimeAsync(1000); expect(root.hidden).toBe(false)
  hud.update({ position: 110, duration: 600 }); expect(root.querySelector('progress')!.value).toBe(110)
  await vi.advanceTimersByTimeAsync(2000); expect(root.hidden).toBe(true)
  hud.show({ position: 20, duration: Infinity }, 10); expect(root.hidden).toBe(true)
  hud.hide()
})

it('uses compact remote scrubbing without activating hidden controls, and blocks seeking live channels', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const key = (key: string, keyCode = 0) => document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))
  const kind = el<HTMLSelectElement>('source-kind'); kind.value = 'direct'; kind.dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.com/movie.mp4'; await click('connect')
  el('channels').querySelector<HTMLButtonElement>('button')!.click()
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'duration', { value: 600, configurable: true })
  video.currentTime = 120; video.dispatchEvent(new Event('playing')); await vi.advanceTimersByTimeAsync(1000)
  el('seek-position').focus()
  await vi.advanceTimersByTimeAsync(6500); expect(el('controls').hidden).toBe(true)
  video.currentTime = 200
  key('ArrowRight'); expect(video.currentTime).toBe(210); expect(el('controls').hidden).toBe(true); expect(el('scrub-osd').hidden).toBe(false)
  expect(el('scrub-osd').textContent).toContain('3:30')
  video.dispatchEvent(new Event('waiting')); expect(el('playback-busy').hidden).toBe(false); expect(el('controls').hidden).toBe(true)
  await vi.advanceTimersByTimeAsync(1000); expect(el('scrub-osd').hidden).toBe(false)
  video.dispatchEvent(new Event('playing')); expect(el('playback-busy').hidden).toBe(true); expect(el('controls').hidden).toBe(true)
  key('Enter'); expect(el('controls').hidden).toBe(false); expect(el('scrub-osd').hidden).toBe(true); expect(document.activeElement).toBe(el('toggle'))
  expect(el('toggle').textContent).toBe('Pause')
  await click('hide-controls'); key('ArrowLeft'); expect(video.currentTime).toBe(200)
  await vi.advanceTimersByTimeAsync(1000)
  expect(el('playback-time').textContent).not.toBe(''); expect(el('playback-remaining').textContent).not.toBe('')
  key('Escape'); expect(el('playback').hidden).toBe(true); expect(el('scrub-osd').hidden).toBe(true)
  await click('change-source'); kind.value = 'playlist'; kind.dispatchEvent(new Event('change'))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1 tvg-type="live",Live test\nhttps://example.com/live.mp4\n')))
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; await click('connect'); await click('nav-live')
  el('channels').querySelector<HTMLButtonElement>('button')!.click(); await click('guide-watch')
  expect(el('playback-time').textContent).toBe(''); expect(el('playback-remaining').textContent).toBe('')
  await vi.advanceTimersByTimeAsync(1000)
  expect(el('playback-time').textContent).toBe('Live stream'); expect(el('playback-remaining').textContent).toBe('')
  video.currentTime = 30; video.dispatchEvent(new Event('playing'))
  await vi.advanceTimersByTimeAsync(1000)
  expect(el('playing-title').textContent).toBe('Live test'); expect(el('player-status').textContent).toBe('Playing')
  expect(el('rewind').hidden).toBe(true); expect(el('seek-controls').hidden).toBe(true)
  await click('hide-controls'); key('', 417); expect(video.currentTime).toBe(30); expect(el('scrub-osd').hidden).toBe(true)
  await click('stop'); vi.clearAllTimers()
})

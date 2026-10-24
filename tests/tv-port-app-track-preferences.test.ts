// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { buildMp4, tx3gCluster } from './helpers/mp4-fixtures'
import { parseMp4Text } from '../tv-app/mp4-text'
import { DEFAULTS, savePreferences } from '../tv-app/preferences'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('applies saved languages to embedded or late native tracks while preserving focus and manual choices', async () => {
  vi.useFakeTimers(); localStorage.clear(); savePreferences(localStorage, { ...DEFAULTS, audio: 'fr', subtitles: 'fr' })
  vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const bytes = buildMp4({ tracks: [
    { trackId: 1, mediaType: 'text', language: 'eng', sampleDurationTicks: 120000, sampleClusters: [tx3gCluster(['English'])] },
    { trackId: 2, mediaType: 'text', language: 'fra', sampleDurationTicks: 120000, sampleClusters: [tx3gCluster(['Français'])] },
  ], moovPosition: 'after-mdat' }).bytes
  vi.stubGlobal('Worker', class {
    onmessage?: (event: unknown) => void; terminate() {}
    postMessage(data: ArrayBuffer) { this.onmessage?.({ data: { tracks: parseMp4Text(new Uint8Array(data)) } }) }
  })
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range')!)!, start = +match[1], end = Math.min(+match[2], bytes.length - 1)
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } })
  }); vi.stubGlobal('fetch', fetch)
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const choose = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  await choose('source-kind', 'direct'); el<HTMLInputElement>('source-url').value = 'https://video.example/movie.mp4'
  await click('connect'); (el('channels').querySelector('button') as HTMLButtonElement).click()
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'duration', { value: 240 }); video.currentTime = 2
  const focus = document.activeElement
  video.dispatchEvent(new Event('playing')); await vi.advanceTimersByTimeAsync(0)
  expect(el('external-subtitles').textContent).toBe('Français'); expect(el('track-menu').hidden).toBe(true)
  expect(document.activeElement).toBe(focus)
  await click('tracks-open'); expect(el<HTMLSelectElement>('subtitle-track').value).toBe('mp4-text-2')
  await choose('subtitle-track', 'mp4-text-1'); video.dispatchEvent(new Event('playing')); await vi.advanceTimersByTimeAsync(3000)
  expect(el('external-subtitles').textContent).toBe('English')
  await choose('subtitle-track', 'off'); const requests = fetch.mock.calls.length
  video.currentTime = 60; video.dispatchEvent(new Event('playing')); await vi.advanceTimersByTimeAsync(4000)
  expect(el('external-subtitles').hidden).toBe(true); expect(fetch).toHaveBeenCalledTimes(requests)
  await click('tracks-close'); await click('stop')
  // The next stream starts with a native nonmatching subtitle; matching audio/captions arrive later.
  const subtitles = [{ kind: 'subtitles', label: 'English', language: 'en', mode: 'showing' }]
  const audio = [{ label: 'English', language: 'en', enabled: true }]
  Object.defineProperty(video, 'textTracks', { value: subtitles }); Object.defineProperty(video, 'audioTracks', { value: audio })
  ;(el('channels').querySelector('button') as HTMLButtonElement).click()
  if (!el('resume').hidden) await click('resume-start')
  video.currentTime = 2
  video.dispatchEvent(new Event('playing')); await vi.advanceTimersByTimeAsync(0)
  expect(fetch).toHaveBeenCalledTimes(requests); expect(subtitles[0].mode).toBe('showing')
  await click('tracks-open'); el('subtitle-track').focus()
  subtitles.push({ kind: 'subtitles', label: 'French', language: 'fre', mode: 'disabled' })
  audio.push({ label: 'French', language: 'fra', enabled: false })
  // Do not replace a native select's options while its popup is open.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(subtitles[1].mode).toBe('showing'); expect(audio[1].enabled).toBe(true)
  expect(el('subtitle-track').textContent).not.toContain('French')
  document.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(1000)
  expect(el<HTMLSelectElement>('subtitle-track').value).toBe('1'); expect(document.activeElement).toBe(el('subtitle-track'))
  await choose('subtitle-track', '0'); await choose('audio-track', '0')
  video.dispatchEvent(new Event('playing')); await vi.advanceTimersByTimeAsync(3000)
  expect(subtitles[0].mode).toBe('showing'); expect(subtitles[1].mode).toBe('disabled'); expect(audio[0].enabled).toBe(true)
  await click('tracks-close'); await click('stop'); vi.clearAllTimers()
})

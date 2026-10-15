// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { buildMp4, tx3gCluster } from './helpers/mp4-fixtures'
import { parseMp4Text } from '../tv-app/mp4-text'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('discovers MP4 tracks, reads ahead after seeks, preserves presentation and switches to external files or Off', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const bytes = buildMp4({ tracks: [{ trackId: 1, mediaType: 'text', language: 'eng', sampleDurationTicks: 30000, sampleClusters: [tx3gCluster(['Opening', 'Second', 'Third', 'Ending'])] }], moovPosition: 'after-mdat' }).bytes
  const terminate = vi.fn()
  vi.stubGlobal('Worker', class {
    onmessage?: (event: unknown) => void; terminate = terminate
    constructor(url: string) { expect(url).toBe('mp4-text-worker.js') }
    postMessage(data: ArrayBuffer) { this.onmessage?.({ data: { tracks: parseMp4Text(new Uint8Array(data)) } }) }
  })
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('.vtt')) return new Response('WEBVTT\n\n00:00.000 --> 04:00.000\nExternal captions')
    const range = new Headers(init.headers).get('range')!, match = /^bytes=(\d+)-(\d+)$/.exec(range)!, start = +match[1], end = Math.min(+match[2], bytes.length - 1)
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } })
  }); vi.stubGlobal('fetch', fetch)
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const choose = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  await choose('source-kind', 'direct'); el<HTMLInputElement>('source-url').value = 'https://video.example/movie.mp4'
  await click('connect'); (el('channels').querySelector('button') as HTMLButtonElement).click()
  const video = document.querySelector('video')!; Object.defineProperty(video, 'duration', { value: 240 }); video.currentTime = 2; video.dispatchEvent(new Event('playing'))
  await click('tracks-open'); expect(el('subtitle-track').textContent).toContain('English · MP4 1'); expect(terminate).toHaveBeenCalledOnce()
  await choose('subtitle-track', 'mp4-text-1'); expect(el('external-subtitles').textContent).toBe('Opening')
  await choose('subtitle-size', '1.5'); await choose('subtitle-delay', '1'); await click('tracks-close')
  video.currentTime = 100; await vi.advanceTimersByTimeAsync(1000)
  expect(el('external-subtitles').textContent).toBe('Ending'); expect(el('external-subtitles').style.fontSize).toBe('6vh')
  await click('tracks-open'); expect(el<HTMLSelectElement>('subtitle-delay').value).toBe('1')
  await click('subtitle-add'); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/external.vtt'; await click('subtitle-load')
  expect(el('external-subtitles').textContent).toBe('External captions'); expect(el<HTMLSelectElement>('subtitle-track').value).toBe('external-file')
  await choose('subtitle-track', 'mp4-text-1'); expect(el('external-subtitles').textContent).toBe('Ending')
  expect(el<HTMLSelectElement>('subtitle-track').querySelector('[value="external-file"]')).toBeNull()
  await choose('subtitle-track', 'off'); expect(el('external-subtitles').hidden).toBe(true)
  const requests = fetch.mock.calls.length; video.currentTime = 30; await vi.advanceTimersByTimeAsync(40000); expect(fetch).toHaveBeenCalledTimes(requests)
  await click('tracks-close'); await click('stop'); expect(el('external-subtitles').textContent).toBe('')
  vi.clearAllTimers()
})

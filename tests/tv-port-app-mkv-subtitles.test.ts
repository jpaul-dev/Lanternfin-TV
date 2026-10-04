// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { parseMkvMetadata, type MkvMetadataInput } from '../tv-app/mkv-text'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('discovers MKV captions through the real app, switches language, seeks and clears captions with Off', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const bytes = readFileSync('tests/fixtures/tv-mkv-text.mkv'), terminate = vi.fn()
  vi.stubGlobal('Worker', class {
    onmessage?: (event: unknown) => void; terminate = terminate
    constructor(url: string) { expect(url).toBe('mkv-text-worker.js') }
    postMessage(data: MkvMetadataInput) { this.onmessage?.({ data: { metadata: parseMkvMetadata(data) } }) }
  })
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range')!)!, start = +match[1], end = Math.min(+match[2], bytes.length - 1)
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } })
  }); vi.stubGlobal('fetch', fetcher)
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const choose = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  await choose('source-kind', 'direct'); el<HTMLInputElement>('source-url').value = 'https://example.test/movie.mkv'
  await click('connect'); el('channels').querySelector<HTMLButtonElement>('button')!.click()
  const video = document.querySelector('video')!; Object.defineProperty(video, 'duration', { value: 70 }); video.currentTime = 2; video.dispatchEvent(new Event('playing'))
  await click('tracks-open'); expect(el('subtitle-track').textContent).toContain('English · MKV 2'); expect(terminate).toHaveBeenCalledOnce()
  await choose('subtitle-track', 'mkv-text-2'); expect(el('external-subtitles').textContent).toContain('English track: opening')
  await choose('subtitle-size', '1.5'); await click('tracks-close'); video.currentTime = 40; await vi.advanceTimersByTimeAsync(1000)
  expect(el('external-subtitles').textContent).toContain('approaching the end'); expect(el('external-subtitles').style.fontSize).toBe('6vh')
  await click('tracks-open'); await choose('subtitle-track', 'mkv-text-3'); expect(el('external-subtitles').textContent).toContain('Piste francaise')
  expect(el('external-subtitles').style.fontSize).toBe('6vh'); expect(el<HTMLSelectElement>('subtitle-size').value).toBe('1.5')
  await click('tracks-close'); video.currentTime = 65; await vi.advanceTimersByTimeAsync(1000); expect(el('external-subtitles').textContent).toContain('Piste francaise')
  await click('tracks-open'); await choose('subtitle-track', 'off'); expect(el('external-subtitles').hidden).toBe(true)
  const requests = fetcher.mock.calls.length; video.currentTime = 5; await vi.advanceTimersByTimeAsync(40000); expect(fetcher).toHaveBeenCalledTimes(requests)
  await click('tracks-close'); await click('stop'); expect(el('external-subtitles').textContent).toBe(''); vi.clearAllTimers()
})

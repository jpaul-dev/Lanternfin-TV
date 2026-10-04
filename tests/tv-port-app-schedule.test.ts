// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'

const playback = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn(), timeline: () => ({ position: 0, duration: 0 }), tracks: () => [] }))
vi.mock('../tv-app/adaptive-player', () => ({ tvPlayer: () => playback }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('opens the grid from Live TV, refreshes XMLTV, restores details/playback focus, and keeps Home card focus', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 4, 12, 15)); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear()
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const start = Date.UTC(2026, 9, 4, 12), half = 1800000
  const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
  const xml = '<tv>' + [1, 2, 3].map(id => `<channel id="ch${id}"><display-name>Channel ${id}</display-name></channel>` + Array.from({ length: 8 }, (_, n) => `<programme channel="ch${id}" start="${stamp(start + n * half)}" stop="${stamp(start + (n + 1) * half)}"><title>Show ${id}-${n}</title></programme>`).join('')).join('') + '</tv>'
  const m3u = '#EXTM3U x-tvg-url="https://example.test/guide.xml"\n' + [1, 2, 3].map(id => `#EXTINF:-1 tvg-id="ch${id}" group-title="News",Channel ${id}\nhttps://example.test/${id}.m3u8`).join('\n') + '\n#EXTINF:-1 tvg-type="movie",Movie one\nhttps://example.test/movie.mp4'
  class TestWorker { onmessage?: (event: { data: unknown }) => void; terminate() {}; postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) } }
  vi.stubGlobal('Worker', TestWorker)
  const fetcher = vi.fn(async (url: string) => new Response(url.endsWith('guide.xml') ? xml : m3u)); vi.stubGlobal('fetch', fetcher)
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(300) }
  const press = async (key: string) => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await vi.advanceTimersByTimeAsync(300) }
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; await click('connect'); await click('nav-live')
  expect(el('schedule').hidden).toBe(false); expect(el('catalog').hidden).toBe(true); expect(el('schedule-rows').children).toHaveLength(3)
  await press('ArrowRight'); await press('ArrowDown'); await press('Enter')
  expect(el('programme-title').textContent).toBe('Show 2-1'); await press('Escape'); expect(document.activeElement?.textContent).toBe('Show 2-1')
  await click('schedule-now'); await press('Enter'); expect(el('playback').hidden).toBe(false); expect(playback.play).toHaveBeenCalledWith(expect.objectContaining({ name: 'Channel 2' }), 0)
  await press('Escape'); expect(el('schedule').hidden).toBe(false); expect(document.activeElement?.textContent).toBe('Show 2-0')
  await click('schedule-more'); await click('schedule-refresh'); expect(el('schedule-rows').textContent).toContain('Show 2-0')
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('guide.xml'))).toHaveLength(2)
  await press('Escape'); await press('Escape'); expect(el('catalog').hidden).toBe(false)
  const movie = [...el('home-rows').querySelectorAll<HTMLButtonElement>('.channel')].find(node => node.textContent?.includes('Movie one'))!
  movie.focus(); movie.click(); await vi.advanceTimersByTimeAsync(300); expect(el('detail').hidden).toBe(false)
  await press('Escape'); expect(document.activeElement?.textContent).toContain('Movie one')
  await click('nav-live'); window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); await vi.advanceTimersByTimeAsync(300)
  expect(el('schedule').hidden).toBe(false); expect(document.activeElement?.textContent).toContain('Show')
  window.dispatchEvent(new Event('pagehide')); vi.clearAllTimers()
})

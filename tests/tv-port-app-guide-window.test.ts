// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { DEFAULTS, savePreferences } from '../tv-app/preferences'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('shows complete past/future calendar days and date-specific empty states through the actual picker', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 3, 12)); vi.stubGlobal('__TV_TARGET__', 'browser')
  localStorage.clear(); savePreferences(localStorage, { ...DEFAULTS, guideClock: '0' })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const past = Date.UTC(2026, 8, 26), future = Date.UTC(2026, 9, 5), hour = 3600000
  const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
  const entry = (start: number, title: string) => `<programme channel="news" start="${stamp(start)}" stop="${stamp(start + hour)}"><title>${title}</title></programme>`
  const xml = '<tv><channel id="news"><display-name>News</display-name></channel>' + [past, future].map((day, i) => Array.from({ length: 24 }, (_, n) => entry(day + n * hour, `${i ? 'Future' : 'Earlier'} ${n}`)).join('')).join('') + entry(Date.now(), 'Current news') + '</tv>'
  class TestWorker {
    onmessage?: (event: { data: unknown }) => void
    terminate() {}
    postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
  }
  vi.stubGlobal('Worker', TestWorker)
  const fetcher = vi.fn(async (url: string) => new Response(url.endsWith('/guide.xml') ? xml : '#EXTM3U x-tvg-url="https://example.test/guide.xml"\n#EXTINF:-1 tvg-id="news",News\nhttps://example.test/live.m3u8'))
  vi.stubGlobal('fetch', fetcher)
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const choose = async (value: string) => { el<HTMLSelectElement>('guide-day').value = value; el('guide-day').dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500) }
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; await click('connect'); await click('nav-live')
  expect(el('guide-status').textContent).toContain('On now')
  for (const [day, prefix] of [[past, 'Earlier'], [future, 'Future']] as const) {
    await choose(String(day))
    expect(el('guide-programmes').querySelectorAll('button')).toHaveLength(24)
    expect(el('guide-programmes').textContent).toContain(`${prefix} 0`); expect(el('guide-programmes').textContent).toContain(`${prefix} 23`)
    expect(el('guide-status').textContent).toMatch(/^24 programmes · /)
    expect(el('guide-page').textContent).toBe('1 / 1')
  }
  await choose(String(Date.UTC(2026, 9, 4))); expect(el('guide-status').textContent).toBe('No listings for this date.')
  await choose('now'); expect(el('guide-status').textContent).toContain('On now')
  expect(fetcher).toHaveBeenCalledTimes(2)
  const keepVisible = vi.fn(); el('guide-programmes').scrollIntoView = keepVisible
  el('guide-refresh').click(); el('guide-programmes').focus(); await vi.advanceTimersByTimeAsync(500)
  expect(document.activeElement).toBe(el('guide-programmes'))
  expect(keepVisible).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  keepVisible.mockClear()
  el('guide-refresh').click(); el('search').focus(); await vi.advanceTimersByTimeAsync(500)
  expect(document.activeElement).toBe(el('search')); expect(keepVisible).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('pagehide')); vi.clearAllTimers()
})

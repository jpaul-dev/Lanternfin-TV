// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { DEFAULTS, savePreferences } from '../tv-app/preferences'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('enters an asynchronously filled guide, selects programmes and crosses page edges without focusing the scroll container', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 3, 12)); vi.stubGlobal('__TV_TARGET__', 'browser')
  localStorage.clear(); savePreferences(localStorage, { ...DEFAULTS, guideClock: '0', scale: 1.5, overscan: 8 })
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const day = Date.UTC(2026, 9, 2), halfHour = 1800000
  const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
  const xml = '<tv><channel id="news"><display-name>News</display-name></channel>' + Array.from({ length: 48 }, (_, n) => `<programme channel="news" start="${stamp(day + n * halfHour)}" stop="${stamp(day + (n + 1) * halfHour)}"><title>Programme ${n}</title></programme>`).join('') + '</tv>'
  class TestWorker {
    onmessage?: (event: { data: unknown }) => void
    terminate() {}
    postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
  }
  vi.stubGlobal('Worker', TestWorker)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('/guide.xml') ? xml : '#EXTM3U x-tvg-url="https://example.test/guide.xml"\n#EXTINF:-1 tvg-id="news",News\nhttps://example.test/live.m3u8')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const press = (key: string, keyCode = 0) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))
  const rows = () => [...el('guide-programmes').querySelectorAll<HTMLButtonElement>('button')]
  const choose = async (value: string) => { el<HTMLSelectElement>('guide-day').value = value; el('guide-day').dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500) }
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; await click('connect'); await click('nav-live'); await click('schedule-more'); await click('schedule-list')
  expect(el('guide-programmes').tabIndex).toBe(0)
  el<HTMLSelectElement>('guide-day').value = String(day); el('guide-day').dispatchEvent(new Event('change'))
  el('guide-programmes').focus(); await vi.advanceTimersByTimeAsync(500)
  expect(el('guide-programmes').tabIndex).toBe(-1)
  expect(document.activeElement).toBe(el('guide-programmes'))
  press('Enter'); expect(document.activeElement).toBe(rows()[0]); expect(el('programme').hidden).toBe(true)
  press('ArrowDown'); expect(document.activeElement).toBe(rows()[1])
  ;(document.activeElement as HTMLButtonElement).click()
  expect(el('programme-title').textContent).toBe('Programme 1'); expect(el('programme').hidden).toBe(false)
  await click('programme-back'); expect(document.activeElement).toBe(rows()[1])
  rows().at(-1)!.focus(); press('ArrowDown')
  expect(el('guide-page').textContent).toBe('2 / 2'); expect(document.activeElement).toBe(rows()[0]); expect(document.activeElement?.textContent).toContain('Programme 24')
  press('ArrowUp'); expect(el('guide-page').textContent).toBe('1 / 2'); expect(document.activeElement).toBe(rows().at(-1))
  press('PageDown'); expect(el('guide-page').textContent).toBe('2 / 2'); expect(document.activeElement).toBe(rows()[0])
  rows().at(-1)!.focus(); press('ArrowDown'); expect(document.activeElement).toBe(rows().at(-1))
  press('', 427); expect(el('guide-page').textContent).toBe('1 / 2'); expect(document.activeElement).toBe(rows().at(-1))
  rows()[0].focus(); press('ArrowUp'); expect(document.activeElement).toBe(el('guide-day'))
  await choose(String(Date.UTC(2026, 9, 4))); expect(rows()).toHaveLength(0); expect(el('guide-programmes').tabIndex).toBe(0)
  el('guide-programmes').focus(); press('Enter'); expect(document.activeElement).toBe(el('guide-programmes'))
  expect(el('programme').hidden).toBe(true)
  vi.setSystemTime(day + 23 * 3600000); await choose('now'); await click('guide-refresh')
  expect(rows()).toHaveLength(2); rows()[0].focus()
  await vi.advanceTimersByTimeAsync(31 * 60000)
  expect(document.activeElement).toBe(rows()[0]); expect(document.activeElement?.textContent).toContain('Programme 47')
  await vi.advanceTimersByTimeAsync(30 * 60000)
  expect(rows()).toHaveLength(0); expect(document.activeElement).toBe(el('guide-programmes')); expect(el('guide-programmes').tabIndex).toBe(0)
  window.dispatchEvent(new Event('pagehide')); vi.clearAllTimers()
})

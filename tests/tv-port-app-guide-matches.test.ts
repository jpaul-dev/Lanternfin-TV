// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { TVLibrary } from '../tv-app/library'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('applies and resets a guide match through the app, keeps the selected channel, and cancels when backgrounded', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 3, 12)); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear()
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  class TestWorker {
    onmessage?: (event: { data: unknown }) => void
    terminate() {}
    postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
  }
  vi.stubGlobal('Worker', TestWorker)
  const xml = '<tv><channel id="provider.a"><display-name>Provider A</display-name></channel><channel id="provider.b"><display-name>Provider B</display-name></channel><programme channel="provider.a" start="20261003110000 +0000" stop="20261003130000 +0000"><title>Schedule A</title></programme><programme channel="provider.b" start="20261003110000 +0000" stop="20261003130000 +0000"><title>Schedule B</title></programme></tv>'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('/guide.xml') ? xml : '#EXTM3U x-tvg-url="https://example.test/guide.xml"\n#EXTINF:-1 tvg-id="provider.a",First\nhttps://example.test/first.m3u8\n#EXTINF:-1 tvg-id="wrong-id",Second\nhttps://example.test/second.m3u8')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const wait = () => vi.advanceTimersByTimeAsync(500), click = async (id: string) => { el(id).click(); await wait() }
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-live'); await click('schedule-more'); await click('schedule-list'); el('channels').querySelectorAll<HTMLButtonElement>('button')[1].focus(); await wait()
  expect(el('guide-title').textContent).toBe('Second'); expect(el('guide-programmes').textContent).not.toContain('Schedule')
  await click('guide-match-open'); expect(el('guide-match').hidden).toBe(false); expect(el('about-open').hidden).toBe(true)
  const search = el<HTMLInputElement>('guide-match-search'); search.value = 'provider.b'; search.dispatchEvent(new Event('input')); await wait()
  el('guide-match-list').querySelector<HTMLButtonElement>('button')!.click(); await wait()
  expect(el('catalog').hidden).toBe(false); expect(el('guide-title').textContent).toBe('Second'); expect(el('guide-programmes').textContent).toContain('Schedule B')
  expect(document.activeElement).toBe(el('guide-match-open'))
  const source = { kind: 'playlist' as const, url: 'https://example.test/list.m3u', username: '', password: '' }, channel = { name: 'Second', group: '', url: 'https://example.test/second.m3u8' }
  expect(new TVLibrary(localStorage, source).guideMatch(channel)).toBe('provider.b')
  await click('guide-match-open'); await click('guide-match-automatic')
  expect(new TVLibrary(localStorage, source).guideMatch(channel)).toBeUndefined(); expect(el('guide-programmes').textContent).not.toContain('Schedule B')
  await click('guide-match-open'); document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true, cancelable: true })); await wait()
  expect(el('catalog').hidden).toBe(false); expect(el('guide-title').textContent).toBe('Second')
  await click('guide-match-open'); window.dispatchEvent(new Event('pagehide')); await wait()
  expect(el('guide-match-list').childElementCount).toBe(0); expect(el<HTMLButtonElement>('guide-match-automatic').disabled).toBe(true)
  window.dispatchEvent(new Event('pageshow')); await click('guide-match-back'); await click('guide-match-open')
  expect(el('guide-match-list').childElementCount).toBe(2)
  document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true, cancelable: true })); await wait(); expect(el('catalog').hidden).toBe(false)
  window.dispatchEvent(new Event('pagehide')); vi.clearAllTimers()
})

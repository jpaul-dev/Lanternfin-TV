// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { readProfiles } from '../tv-app/profiles'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('offers Automatic without changing defaults, reports the estimate, persists the mode and keeps manual overrides', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear(); sessionStorage.clear()
  class TestWorker { onmessage?: (event: { data: unknown }) => void; terminate() {}; postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) } }
  vi.stubGlobal('Worker', TestWorker)
  const now = Date.now(), stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const xml = '<tv>' + Array.from({ length: 3 }, (_, id) => `<channel id="n${id}"><display-name>News ${id}</display-name></channel><programme channel="n${id}" start="${stamp(now + 115 * 60000)}" stop="${stamp(now + 125 * 60000)}"><title>Current news</title></programme>`).join('') + '</tv>'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('.xml') ? xml : '#EXTM3U x-tvg-url="https://example.test/guide.xml"\n#EXTINF:-1 tvg-id="n0",News 0\nhttps://example.test/live.m3u8')))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const choose = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(500) }
  expect(el<HTMLSelectElement>('guide-offset').value).toBe('0')
  expect([...el<HTMLSelectElement>('guide-offset').options].some(option => option.value === 'auto')).toBe(true)
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); await click('nav-live'); expect(el('guide-status').textContent).toBe('Coming up')
  await click('nav-settings'); await choose('source-guide-offset', 'auto'); await click('nav-live')
  expect(el('guide-status').textContent).toContain('On now'); expect(el('guide-programmes').textContent).toContain('Current news')
  await click('nav-settings'); expect(el('guide-auto-note').hidden).toBe(false); expect(el('guide-auto-note').textContent).toContain('Estimated correction: −02:00'); expect(el('guide-auto-note').textContent).toContain('3 channels')
  expect(readProfiles(localStorage)[0].guideOffset).toBe('auto')
  await click('settings-refresh'); await click('nav-settings'); expect(el<HTMLSelectElement>('source-guide-offset').value).toBe('auto')
  await choose('source-guide-offset', '0'); expect(el('guide-auto-note').hidden).toBe(true); await click('nav-live'); expect(el('guide-status').textContent).toBe('Coming up')
  await click('nav-settings'); await click('settings-source'); await click('profile-new'); expect(el<HTMLSelectElement>('guide-offset').value).toBe('0')
  vi.clearAllTimers()
})

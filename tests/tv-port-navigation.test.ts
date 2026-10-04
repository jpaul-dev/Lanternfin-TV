// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('tunes live channels, cancels number entry, and handles short/held OK without double activation', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1,One\nhttps://example.com/1.mp4\n#EXTINF:-1,Two\nhttps://example.com/2.mp4\n#EXTINF:-1 tvg-type="movie",Movie\nhttps://example.com/3.mp4\n')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const key = (key: string, type = 'keydown', repeat = false) => document.dispatchEvent(new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(el('source-name'))
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; await click('connect'); await click('nav-live'); await click('schedule-more'); await click('schedule-list')
  const first = el('channels').querySelector<HTMLButtonElement>('button')!; first.focus()
  key('Enter'); await vi.advanceTimersByTimeAsync(100); key('Enter', 'keyup'); await vi.advanceTimersByTimeAsync(0)
  expect(el('playback').hidden).toBe(false); expect(el('playing-title').textContent).toBe('One')
  key('ChannelUp'); await vi.advanceTimersByTimeAsync(0); expect(el('playing-title').textContent).toBe('Two')
  key('2'); key('Escape'); await vi.advanceTimersByTimeAsync(1200); expect(el('playback').hidden).toBe(false)
  key('1'); await vi.advanceTimersByTimeAsync(1000); expect(el('playing-title').textContent).toBe('One')
  key('3'); key('Enter'); expect(el('zap-number').textContent).toContain('not in this list'); expect(el('playing-title').textContent).toBe('One')
  await click('stop'); const card = el('channels').querySelector<HTMLButtonElement>('button')!; card.focus()
  key('Enter'); await vi.advanceTimersByTimeAsync(600); expect(el('card-menu').hidden).toBe(false)
  key('Enter', 'keydown', true); expect(el('playback').hidden).toBe(true)
  key('Enter', 'keyup'); await click('card-menu-favorite')
  expect(el('card-menu').hidden).toBe(true); expect(el('channels').textContent).toContain('★ One')
  expect(el('channels').contains(document.activeElement)).toBe(true)
  await click('view-favorites'); expect(el('channels').querySelectorAll('button')).toHaveLength(1)
  vi.clearAllTimers()
})

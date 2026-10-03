// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { downloadsUI } from '../tv-app/downloads-ui'
import { TVDownloads } from '../tv-app/downloads'
import { downloadDevice } from './helpers/tv-downloads'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const markup = () => { localStorage.clear(); document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8') }
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

it('reviews a download before sending any request, preserves focus during progress and reviews removal', async () => {
  vi.useFakeTimers(); markup()
  const device = downloadDevice(), downloads = new TVDownloads(device.api), play = vi.fn()
  const view = downloadsUI(el('downloads'), downloads, play)
  el('downloads').hidden = false
  view.open({ name: '<img src=x onerror=alert(1)>', url: 'https://example.test/a.mp4', mediaKind: 'movie', group: '' })
  expect(el('downloads-review').hidden).toBe(false); expect(el('downloads-title').children).toHaveLength(0)
  expect(device.api.download.start).not.toHaveBeenCalled()
  el('downloads-start').click(); await vi.advanceTimersByTimeAsync(0)
  const pause = el('downloads-list').querySelector('button')!; pause.focus()
  device.listeners.get(1)!.onprogress(1, 40, 100)
  expect(document.activeElement).toBe(pause)
  expect(el('downloads-list').querySelector('progress')!.value).toBe(40)
  device.complete(1)
  el('downloads-list').querySelector('button')!.click()
  expect(play).toHaveBeenCalledWith(expect.objectContaining({ name: '<img src=x onerror=alert(1)>', group: 'Downloads' }), 0)
  ;(el('downloads-list').querySelectorAll('button')[1] as HTMLButtonElement).click()
  expect(document.activeElement).toBe(el('downloads-keep')); expect(device.api.filesystem.deleteFile).not.toHaveBeenCalled()
  expect(view.back()).toBe(true); expect(device.api.filesystem.deleteFile).not.toHaveBeenCalled()
  ;(el('downloads-list').querySelectorAll('button')[1] as HTMLButtonElement).click(); el('downloads-remove').click(); await vi.advanceTimersByTimeAsync(0)
  expect(downloads.list()).toHaveLength(0)
})

it('keeps unavailable environments honest and never starts a fake download', () => {
  markup()
  const downloads = new TVDownloads(), view = downloadsUI(el('downloads'), downloads, vi.fn())
  view.open({ name: 'Movie', url: 'https://example.test/a.mp4', mediaKind: 'movie', group: '' })
  expect(el('downloads-review').hidden).toBe(true)
  expect(el('downloads-status').textContent).toContain('unavailable')
  expect(el('downloads-support').textContent).toContain('cannot save')
})

it('plays a saved video from setup without a source, ignores network loss, saves resume and returns to downloads', async () => {
  vi.useFakeTimers(); markup(); vi.stubGlobal('__TV_TARGET__', 'tizen')
  const device = downloadDevice(), seed = new TVDownloads(device.api)
  await seed.start({ name: 'Offline episode', mediaKind: 'episode', url: 'https://example.test/episode.mp4', group: '' }); device.complete(1)
  let state = 'NONE', position = 0
  const avplay = {
    open: vi.fn(() => { state = 'IDLE' }), close: vi.fn(() => { state = 'NONE' }), stop: vi.fn(() => { state = 'IDLE' }),
    play: vi.fn(() => { state = 'PLAYING' }), pause: vi.fn(() => { state = 'PAUSED' }), getState: () => state,
    getDuration: () => 600000, getCurrentTime: () => position, setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(),
    setListener: vi.fn(), prepareAsync: (ok: () => void) => { state = 'READY'; ok() }, seekTo: vi.fn(),
  }
  vi.stubGlobal('tizen', device.api); vi.stubGlobal('webapis', { avplay })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network should be used')))
  await import('../tv-app/app')
  el('setup-downloads').click(); expect(el('downloads').hidden).toBe(false)
  el('downloads-list').querySelector('button')!.click()
  expect(el('playback').hidden).toBe(false); expect(avplay.open).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\//))
  expect(el('favorite').hidden).toBe(true); expect(el('playback-kind').textContent).toBe('WATCHING OFFLINE')
  window.dispatchEvent(new Event('offline')); expect(state).toBe('PLAYING')
  position = 125000; await vi.advanceTimersByTimeAsync(11000)
  el('stop').click(); expect(el('downloads').hidden).toBe(false)
  expect(el('downloads-list').textContent).toContain('Continue · 2:05')
  expect(fetch).not.toHaveBeenCalled()
  el('downloads-back').click(); expect(el('setup').hidden).toBe(false)
})

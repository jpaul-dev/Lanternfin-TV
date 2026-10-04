// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { TVLibrary } from '../tv-app/library'

const restarted = vi.hoisted(() => vi.fn())
vi.mock('../tv-app/reset-ui', async original => {
  const actual = await original<typeof import('../tv-app/reset-ui')>()
  return { resetUI: (root: HTMLElement, run: (files: boolean) => Promise<void>) => actual.resetUI(root, run, restarted) }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('offers recovery before opening a source, returns from backup/downloads, cancels on Back or background, and resets the active app', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__TV_TARGET__', 'browser'); localStorage.clear(); sessionStorage.clear()
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1,Test movie\nhttps://example.test/movie.mp4')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const wait = () => vi.advanceTimersByTimeAsync(500), click = async (id: string) => { el(id).click(); await wait() }
  await click('setup-reset-app'); expect(el('reset').hidden).toBe(false); expect(document.activeElement).toBe(el('reset-back'))
  await click('reset-backup'); expect(el('backup').hidden).toBe(false)
  await click('backup-back'); expect(el('reset').hidden).toBe(false)
  await click('reset-downloads'); expect(el('downloads').hidden).toBe(false)
  await click('downloads-back'); expect(el('reset').hidden).toBe(false)
  await click('reset-downloads')
  document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true, cancelable: true })); await wait()
  expect(el('reset').hidden).toBe(false)
  await click('reset-confirm'); expect(el<HTMLButtonElement>('reset-apply').disabled).toBe(false)
  await click('reset-confirm')
  for (const keyCode of [461, 10009]) {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true })); await wait()
    expect(el('setup').hidden).toBe(false); expect(document.activeElement).toBe(el('setup-reset-app'))
    await click('setup-reset-app')
  }
  await click('reset-confirm'); expect(el<HTMLInputElement>('reset-confirm').checked).toBe(true)
  window.dispatchEvent(new Event('pagehide')); await wait(); expect(el('reset').hidden).toBe(true)
  window.dispatchEvent(new Event('pageshow')); await click('setup-reset-app')
  expect(el<HTMLInputElement>('reset-confirm').checked).toBe(false); await click('reset-back')
  el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'; el<HTMLInputElement>('remember').checked = true
  await click('connect'); expect(el('catalog').hidden).toBe(false)
  const source = { kind: 'playlist' as const, url: 'https://example.test/list.m3u', username: '', password: '' }
  new TVLibrary(localStorage, source).toggleFavorite({ name: 'Test movie', group: '', url: 'https://example.test/movie.mp4' })
  localStorage.setItem('other.app', 'keep'); localStorage.setItem('lanternfin.downloads.v1', 'retained')
  await click('nav-settings'); await click('settings-reset-app'); await click('reset-confirm'); await click('reset-apply')
  expect(restarted).toHaveBeenCalledOnce(); expect(el('reset-status').textContent).toContain('Reset complete')
  expect(localStorage.length).toBe(2); expect(localStorage.getItem('lanternfin.downloads.v1')).toBe('retained')
  expect(localStorage.getItem('other.app')).toBe('keep')
  // The old page cannot navigate back or persist in-memory source/library state before reload.
  document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true, cancelable: true })); await wait()
  window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow')); await wait()
  expect(el('reset').hidden).toBe(false); expect(localStorage.length).toBe(2)
  vi.clearAllTimers()
})

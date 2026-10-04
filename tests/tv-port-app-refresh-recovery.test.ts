// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { CatalogCache } from '../tv-app/catalog-cache'
import { readProfiles } from '../tv-app/profiles'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('retains the loaded library on failed, cancelled or backgrounded refresh and restores browsing after retry', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  let hidden = false, mode = 'initial'
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(CatalogCache.prototype, 'loadPlaylist').mockResolvedValue(undefined)
  const save = vi.spyOn(CatalogCache.prototype, 'savePlaylist').mockResolvedValue(undefined)
  const pending: { signal: AbortSignal; resolve(response: Response): void }[] = []
  const playlist = (prefix = '') => '#EXTM3U\n' + Array.from({ length: 90 }, (_, i) => '#EXTINF:-1 tvg-type="movie" group-title="Cinema",' + prefix + 'Movie ' + (i + 1) + '\nhttps://example.test/movie/' + i + '.mp4\n').join('')
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (mode === 'failed') throw new TypeError('Network unavailable')
    if (mode === 'pending') return new Promise<Response>(resolve => pending.push({ signal: init.signal, resolve }))
    return new Response(playlist(mode === 'updated' ? 'Updated ' : ''))
  }))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el(id).focus(); el(id).click(); await vi.advanceTimersByTimeAsync(500) }
  const press = async (key: string, keyCode = 0, repeat = false) => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, repeat, bubbles: true, cancelable: true })); await vi.advanceTimersByTimeAsync(500) }
  const release = (key: string, keyCode = 0) => document.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode, bubbles: true, cancelable: true }))
  el<HTMLInputElement>('source-url').value = 'https://example.test/library.m3u'; el<HTMLInputElement>('remember').checked = true; el<HTMLInputElement>('keep-library').checked = true
  await click('connect'); await click('nav-movie')
  el<HTMLInputElement>('search').value = 'Movie'; el('search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(500)
  el<HTMLInputElement>('page-jump').value = '2'; await click('page-go')
  el('channels').querySelectorAll<HTMLButtonElement>('button')[4].focus()
  const selected = (document.activeElement as HTMLElement).dataset.channel, oldCards = el('channels').textContent, savedProfile = readProfiles(localStorage)
  mode = 'failed'; await click('refresh-catalog')
  expect(el<HTMLDialogElement>('library-refresh').open).toBe(true); expect(el('setup').hidden).toBe(true); expect(el('catalog').hidden).toBe(false)
  expect(el('channels').textContent).toBe(oldCards); expect(el('library-refresh').textContent).toContain('Your current library is unchanged')
  expect(readProfiles(localStorage)).toEqual(savedProfile); expect(save).toHaveBeenCalledTimes(1)
  await press('Escape'); await press('Escape', 0, true); release('Escape')
  expect(el<HTMLDialogElement>('library-refresh').open).toBe(false); expect(el('section-title').textContent).toBe('Movies'); expect(el('page-label').textContent).toBe('Page 2 of 4')
  mode = 'failed'; await click('refresh-catalog'); mode = 'updated'; await click('library-refresh-retry')
  expect(el<HTMLDialogElement>('library-refresh').open).toBe(false); expect(el('setup').hidden).toBe(true)
  expect(el('section-title').textContent).toBe('Movies'); expect(el<HTMLInputElement>('search').value).toBe('Movie')
  expect(el('page-label').textContent).toBe('Page 2 of 4'); expect((document.activeElement as HTMLElement).dataset.channel).toBe(selected)
  expect(document.activeElement?.textContent).toContain('Updated Movie 29'); expect(save).toHaveBeenCalledTimes(2)
  mode = 'pending'; await click('refresh-catalog'); expect(el<HTMLDialogElement>('library-refresh').open).toBe(true)
  await press('Enter', 13); await press('Enter', 13, true); release('Enter', 13)
  expect(pending[0].signal.aborted).toBe(true); expect(el<HTMLDialogElement>('library-refresh').open).toBe(false)
  const retained = el('channels').textContent
  pending[0].resolve(new Response(playlist('Late '))); await vi.advanceTimersByTimeAsync(500)
  expect(el('channels').textContent).toBe(retained); expect(save).toHaveBeenCalledTimes(2)
  await click('nav-settings'); await click('settings-refresh')
  hidden = true; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(500)
  expect(pending[1].signal.aborted).toBe(true); expect(el<HTMLDialogElement>('library-refresh').open).toBe(false)
  pending[1].resolve(new Response(playlist('Away '))); hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(500)
  expect(el('settings').hidden).toBe(false); expect(save).toHaveBeenCalledTimes(2)
  mode = 'updated'; await click('settings-refresh')
  expect(el('settings').hidden).toBe(false); expect(document.activeElement?.id).toBe('settings-refresh'); expect(save).toHaveBeenCalledTimes(3)
  vi.clearAllTimers()
})

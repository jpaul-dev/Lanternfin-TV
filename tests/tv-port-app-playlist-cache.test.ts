// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { CatalogCache } from '../tv-app/catalog-cache'
import type { Catalog } from '../tv-app/catalog'
import { readProfiles } from '../tv-app/profiles'
import { createBackup, MemoryStore, restoreBackup } from '../tv-app/backup'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('requires opt-in, restores M3U without fetching, refreshes on request and cancels background or forgotten saves', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  let hidden = false, pending = false, saved: (Catalog & { at: number }) | undefined
  const requests: { resolve: () => void; signal: AbortSignal }[] = []
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const load = vi.spyOn(CatalogCache.prototype, 'loadPlaylist').mockImplementation(async () => saved)
  const save = vi.spyOn(CatalogCache.prototype, 'savePlaylist').mockImplementation(async (_source, catalog, signal) => {
    if (pending) await new Promise<void>(resolve => requests.push({ resolve, signal: signal! }))
    if (!signal?.aborted) saved = { ...catalog, at: Date.now() }
  })
  const forget = vi.spyOn(CatalogCache.prototype, 'forget').mockImplementation(async () => { saved = undefined })
  let title = 'Network movie'
  const fetcher = vi.fn(async () => new Response(`#EXTM3U\n#EXTINF:-1 tvg-type="movie" group-title="Movies",${title}\nhttps://media.example/movie/1.mp4?token=media-token\n`))
  vi.stubGlobal('fetch', fetcher)
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const visibility = async (value: boolean) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) }
  const changeKind = (kind: string) => { el<HTMLSelectElement>('source-kind').value = kind; el('source-kind').dispatchEvent(new Event('change')) }
  const openSaved = async () => { (el('profile-list').querySelector('.profile-open') as HTMLButtonElement).click(); await vi.advanceTimersByTimeAsync(0) }
  expect(el('keep-library-field').hidden).toBe(false); expect(el<HTMLInputElement>('keep-library').checked).toBe(false); expect(el<HTMLInputElement>('keep-library').disabled).toBe(true)
  expect(el('playlist-cache-help').textContent).toContain('not encrypted')
  el<HTMLInputElement>('source-url').value = 'https://provider.example/list.m3u'
  await click('connect'); expect(save).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled()
  await click('change-source'); el<HTMLInputElement>('remember').checked = true; el('remember').dispatchEvent(new Event('change')); el<HTMLInputElement>('keep-library').checked = true
  await click('connect'); expect(save).toHaveBeenCalledTimes(1); expect(el('index-message').textContent).toContain('Playlist saved')
  expect(readProfiles(localStorage)[0].keepLibrary).toBe(true)
  const backup = createBackup(localStorage), target = new MemoryStore(); restoreBackup(target, backup, { library: false, preferences: false })
  expect(readProfiles(target)[0].keepLibrary).toBe(true); expect(JSON.stringify(backup)).not.toContain('media-token')
  fetcher.mockClear(); await click('change-source'); await openSaved()
  expect(fetcher).not.toHaveBeenCalled(); expect(el('index-status').textContent).toContain('Saved playlist'); expect(el('hero-title').textContent).toBe('Network movie')
  title = 'Refreshed movie'; await click('refresh-catalog'); expect(fetcher).toHaveBeenCalledTimes(1); expect(el('hero-title').textContent).toBe(title)
  // A failed cache read falls back to the network and can save the replacement.
  load.mockRejectedValueOnce(new Error('Damaged cache')); await click('change-source'); await openSaved(); expect(fetcher).toHaveBeenCalledTimes(2)
  // A slow background save is restarted on return; its stale result cannot publish.
  pending = true; await click('refresh-catalog'); expect(requests).toHaveLength(1)
  await visibility(true); expect(requests[0].signal.aborted).toBe(true)
  await visibility(false); expect(requests).toHaveLength(2)
  requests[0].resolve(); await vi.advanceTimersByTimeAsync(0); expect(el('index-message').textContent).toContain('Saving this playlist')
  requests[1].resolve(); await vi.advanceTimersByTimeAsync(0); expect(el('index-message').textContent).toContain('Playlist saved')
  // Clearing cannot be undone by a suspended save or by returning to the app.
  await click('refresh-catalog'); await click('nav-settings'); await click('settings-clear-cache')
  expect(requests[2].signal.aborted).toBe(true); requests[2].resolve(); await vi.advanceTimersByTimeAsync(0)
  await visibility(true); await visibility(false); expect(requests).toHaveLength(3); expect(saved).toBeUndefined()
  await click('settings-source'); changeKind('direct'); expect(el('keep-library-field').hidden).toBe(true); expect(el('playlist-cache-help').hidden).toBe(true)
  el<HTMLInputElement>('keep-library').checked = true; changeKind('playlist'); expect(el<HTMLInputElement>('keep-library').checked).toBe(false)
  await click('forget'); expect(forget).toHaveBeenCalled(); expect(readProfiles(localStorage)).toEqual([])
  vi.clearAllTimers()
})

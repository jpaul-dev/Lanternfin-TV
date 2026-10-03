// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_HOME_ROWS, homeLayoutUI, normalizeHomeRows } from '../tv-app/home-layout'
import { homeRows } from '../tv-app/presentation'
import { DEFAULTS, normalizePreferences, readPreferences, savePreferences } from '../tv-app/preferences'
import { createBackup, MemoryStore, restoreBackup } from '../tv-app/backup'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('normalizes bounded row identifiers, preserves an intentionally empty home and isolates returned arrays', () => {
  expect(normalizeHomeRows(['movies', 'watchlist'])).toEqual(['movies', 'watchlist'])
  expect(normalizeHomeRows([])).toEqual([])
  for (const value of [undefined, ['__proto__'], ['movies', 'movies'], Array(8).fill('live'), 'movies']) expect(normalizeHomeRows(value)).toEqual(DEFAULT_HOME_ROWS)
  const preferences = normalizePreferences({}); preferences.homeRows.pop()
  expect(DEFAULTS.homeRows).toEqual(DEFAULT_HOME_ROWS)
})

it('keeps edits local until save and preserves remote focus when moving a row', () => {
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const root = document.getElementById('layout')!, saved = vi.fn(), close = vi.fn(), ui = homeLayoutUI(root, saved, close)
  const button = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!
  ui.open(['movies', 'live'])
  button('[data-row="live"] [data-action="up"]').click()
  expect(root.querySelector('.home-layout-row')?.getAttribute('data-row')).toBe('live')
  expect(document.activeElement).toBe(root.querySelector('[data-row="live"] input'))
  button('[data-row="movies"] input').click(); button('#layout-back').click()
  expect(saved).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
  ui.open(['movies', 'live']); button('[data-row="live"] [data-action="up"]').click(); button('#layout-save').click()
  expect(saved).toHaveBeenLastCalledWith(['live', 'movies'])
  saved.mockImplementationOnce(() => { throw new Error('quota') }); button('#layout-save').click()
  expect(root.querySelector('#layout-status')?.textContent).toContain('previous layout is unchanged')
  expect(close).toHaveBeenCalledTimes(2)
})

it('renders only selected rows in order and carries layout through the optional backup preference import', async () => {
  const root = document.createElement('div'); document.body.replaceChildren(root)
  const channels = [{ name: 'Channel', url: 'https://example.com/live', group: '', mediaKind: 'live' as const }, { name: 'Movie', url: 'https://example.com/movie', group: '', mediaKind: 'movie' as const }]
  await homeRows(root, channels, undefined, () => {}, undefined, ['movies', 'live'])
  expect([...root.querySelectorAll('.home-row')].map(row => (row as HTMLElement).dataset.row)).toEqual(['Movies', 'Live TV'])
  await homeRows(root, channels, undefined, () => {}, undefined, []); expect(root.children).toHaveLength(0)
  const source = new MemoryStore(), target = new MemoryStore()
  savePreferences(source, { ...DEFAULTS, homeRows: ['movies', 'live'] })
  const backup = createBackup(source)
  restoreBackup(target, backup, { library: false, preferences: false }); expect(readPreferences(target).homeRows).toEqual(DEFAULT_HOME_ROWS)
  restoreBackup(target, backup, { library: false, preferences: true }); expect(readPreferences(target).homeRows).toEqual(['movies', 'live'])
})

it('applies the layout through settings and cancels later edits with the TV back key', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1 tvg-type="movie",Movie\nhttps://example.com/movie.mp4\n#EXTINF:-1 tvg-type="live",Channel\nhttps://example.com/live.m3u8\n')))
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; await click('connect'); await click('nav-settings'); await click('settings-home')
  expect(el('layout').hidden).toBe(false); expect(el('settings').hidden).toBe(true)
  el('layout-rows').querySelector<HTMLInputElement>('[data-row="movies"] input')!.click()
  await click('layout-save'); await click('settings-back')
  expect(el('home-rows').querySelector('[data-row="Movies"]')).toBeNull()
  expect(el('home-rows').querySelector('[data-row="Live TV"]')).not.toBeNull()
  expect(readPreferences(localStorage).homeRows).not.toContain('movies')
  await click('nav-settings'); await click('settings-home'); await click('layout-reset')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(el('layout').hidden).toBe(true)
  expect(el('settings').hidden).toBe(false); expect(document.activeElement).toBe(el('settings-home'))
  expect(readPreferences(localStorage).homeRows).not.toContain('movies')
  vi.clearAllTimers()
})

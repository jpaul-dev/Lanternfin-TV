// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { scheduleUI } from '../tv-app/schedule'
import { categoryBrowser } from '../tv-app/category-browser'
import { setInterfaceLanguage } from '../tv-app/i18n'
import type { Channel } from '../tv-app/catalog'

const messages = (code: string) => JSON.parse(readFileSync('tv-app/locales/' + code + '.json', 'utf8'))
const el = (id: string) => document.getElementById('schedule-' + id)!
const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const settle = () => vi.advanceTimersByTimeAsync(0)
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await setInterfaceLanguage('en', async () => ({})) })

it('translates the loaded guide, menus and finder on reopen without translating provider text or moving selection', async () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 9, 4, 12, 15))
  document.body.innerHTML = '<section id="schedule"></section>'
  const channels: Channel[] = Array.from({ length: 20 }, (_, i) => ({ name: i ? 'Channel ' + i : 'TV Guide', group: 'Find a category', url: 'https://example.test/' + i, mediaKind: 'live' }))
  const options = { channels: async () => channels, categories: async () => Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: i ? 'Category ' + i : 'Find a category' })), programmes: async () => [{ start: Date.now() - 900000, stop: Date.now() + 2700000, title: 'Find a channel', description: 'TV Guide' }], clock: () => '0', watch: vi.fn(), details: vi.fn(), list: vi.fn(), back: vi.fn(), sidebar: vi.fn() }
  const ui = scheduleUI(document.getElementById('schedule')!, options)
  try {
    ui.open('demo'); await settle(); press('ArrowDown')
    for (const code of ['fr', 'ar', 'en']) {
      ui.suspend(); const translated = messages(code); await setInterfaceLanguage(code, async () => translated); ui.resume(); await settle()
      expect(document.querySelector('#schedule h1')?.textContent).toBe(translated['TV Guide'])
      expect(el('rows').getAttribute('aria-label')).toBe(translated['Channels and programmes'])
      expect(el('rows').textContent).toContain('TV Guide'); expect(el('title').textContent).toBe('Find a channel')
      expect((document.activeElement as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row).toBe('1')
      el('more').click(); expect(el('options').querySelector('h2')?.textContent).toBe(translated['Guide options'])
      expect(el('find').textContent).toBe(translated['Find a channel']); el('find').click(); await settle()
      expect(el('find-title').textContent).toBe(translated['Find a channel'])
      expect(document.querySelector('label[for="schedule-find-query"]')?.textContent).toBe(translated['Channel name or guide number'])
      expect(el('find-previous').textContent).toBe(translated['Previous page'])
      expect(el('find-results').textContent).toContain('TV Guide')
      press('Escape'); expect((document.activeElement as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row).toBe('1')
      el('category').click(); await settle()
      expect((document.getElementById('schedule-group-search') as HTMLInputElement).placeholder).toBe(translated['Find a category'])
      expect(el('category-list').textContent).toContain('Find a category')
      expect(document.getElementById('schedule-group-next')?.getAttribute('aria-label')).toBe(translated['Next category page'])
      el('categories-back').click()
    }
  } finally { ui.suspend() }
})

it('refreshes category search labels on resume while retaining the query, selected ID and provider labels', async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<section id="categories"><div id="list"></div></section>'
  const ui = categoryBrowser(document.getElementById('categories')!, document.getElementById('list')!, 'test', () => '0')
  try {
    await ui.set(Array.from({ length: 35 }, (_, i) => ({ id: String(i), name: i ? 'Name ' + i : 'TV Guide' })), () => {})
    const search = document.getElementById('test-search') as HTMLInputElement
    search.value = 'TV Guide'; search.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
    ui.suspend(); await setInterfaceLanguage('fr', async () => messages('fr')); ui.resume(); await settle()
    expect(search.value).toBe('TV Guide'); expect(search.placeholder).toBe('Trouver une catégorie')
    expect(document.querySelector('#list button')?.textContent).toBe('TV Guide')
    expect(document.querySelector('#list button')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById('test-status')?.textContent).toBe('1 catégorie')
  } finally { ui.dispose() }
})

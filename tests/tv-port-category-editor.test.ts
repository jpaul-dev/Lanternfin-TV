// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { categoryEditor } from '../tv-app/category-editor'
import type { Category } from '../tv-app/xtream'

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(`visibility-${id}`) as T
const press = (key: string, repeat = false) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }))
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click()
let ui: ReturnType<typeof categoryEditor>, save: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>
beforeEach(() => { vi.useFakeTimers(); document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); document.getElementById('visibility')!.hidden = false; save = vi.fn(); close = vi.fn() })
afterEach(() => { ui?.dispose(); vi.restoreAllMocks(); vi.useRealTimers() })
const entries = Array.from({ length: 10000 }, (_, n) => ({ id: String(n), name: `Category ${String(n).padStart(5,'0')}` }))
async function open(load = vi.fn(async () => entries)) {
  ui = categoryEditor(document.getElementById('visibility')!, { load, save, close }); ui.open({}); await vi.advanceTimersByTimeAsync(0)
}

it('renders at most 16 toggles, preserves focus while checking, searches every category and saves a scoped draft', async () => {
  await open(); expect(el('list').children).toHaveLength(16)
  const first = el('list').children[0] as HTMLElement; first.focus(); press('Enter'); press('Enter', true)
  expect(document.activeElement).toBe(first); expect(first.getAttribute('aria-pressed')).toBe('true'); expect(save).not.toHaveBeenCalled()
  press('ArrowDown'); expect(document.activeElement).toBe(el('list').children[1]); press('ArrowRight'); expect(document.activeElement).toBe(el('list').children[1])
  el<HTMLInputElement>('search').value = '09999'; el('search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
  el('search').focus(); press('Enter'); await vi.advanceTimersByTimeAsync(0)
  expect(el('list').children).toHaveLength(1); expect(el('list').textContent).toBe('Category 09999'); expect(el('list').children[0].getAttribute('aria-pressed')).toBe('false')
  press('Enter'); expect(el('selection').textContent).toBe('2 categories hidden')
  click('[data-kind="movie"]'); await vi.advanceTimersByTimeAsync(0); click('[data-mode="select"]'); (el('list').children[1] as HTMLElement).click()
  el('save').click(); expect(save).toHaveBeenCalledWith({ live: { mode: 'hide', ids: ['0','9999'] }, movie: { mode: 'select', ids: ['1'] } }); expect(close).toHaveBeenCalledOnce()
})

it('supports deterministic header arrows and cancel without writing', async () => {
  await open(); document.querySelector<HTMLElement>('[data-kind="live"]')!.focus(); press('ArrowRight'); expect((document.activeElement as HTMLElement).dataset.kind).toBe('movie')
  press('ArrowDown'); expect((document.activeElement as HTMLElement).dataset.mode).toBe('hide')
  press('ArrowDown'); press('ArrowDown'); expect(document.activeElement).toBe(el('reset')); press('ArrowRight'); expect(document.activeElement).toBe(el('search'))
  press('ArrowDown'); expect(document.activeElement).toBe(el('list').children[0]); press('Enter'); press('Escape')
  expect(save).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
})

it('does not show stale directory replies or activate stale rows after section changes and close', async () => {
  let answer!: (rows: Category[]) => void
  const load = vi.fn().mockResolvedValueOnce(entries).mockImplementationOnce(() => new Promise(resolve => answer = resolve)).mockResolvedValueOnce([{ id: 'new', name: '<img> Series' }])
  await open(load); const old = el('list').children[0] as HTMLElement
  click('[data-kind="movie"]'); click('[data-kind="series"]'); await vi.advanceTimersByTimeAsync(0); answer(entries); await vi.advanceTimersByTimeAsync(0); old.click()
  expect(el('list').textContent).toBe('<img> Series'); expect(el('list').querySelector('img')).toBeNull(); expect(el('selection').textContent).toBe('0 categories hidden')
  ui.close(); el('save').click(); expect(save).not.toHaveBeenCalled()
})

it('preserves retryable draft on storage failure and makes show-all an explicit saved choice', async () => {
  await open(); (el('list').children[0] as HTMLElement).click(); save.mockImplementationOnce(() => { throw new Error('TV storage is full.') }); el('save').click()
  expect(el('note').textContent).toBe('TV storage is full.'); expect(close).not.toHaveBeenCalled(); expect(el('selection').textContent).toBe('1 category hidden')
  el('reset').click(); el('save').click(); expect(save).toHaveBeenLastCalledWith({ live: { mode: 'hide', ids: [] } })
})

it('offers retry after a category load fails', async () => {
  await open(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(entries)); expect(el('retry').hidden).toBe(false)
  el('retry').click(); await vi.advanceTimersByTimeAsync(0); expect(el('retry').hidden).toBe(true); expect(el('list').children).toHaveLength(16)
})

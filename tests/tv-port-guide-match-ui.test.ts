// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { guideMatchUI } from '../tv-app/guide-match-ui'
import type { GuideChoices } from '../tv-app/xmltv'
const el = <T extends HTMLElement = HTMLElement>(name: string) => document.getElementById(`guide-match-${name}`) as T
const result = (id = 'news'): GuideChoices => ({ items: [{ id, name: '<b>News</b>' }], total: 1, page: 0, pages: 1 })
let ui: ReturnType<typeof guideMatchUI>
beforeEach(() => { vi.useFakeTimers(); document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); document.getElementById('guide-match')!.hidden = false })
afterEach(() => { ui?.dispose(); vi.useRealTimers(); vi.restoreAllMocks() })
const key = (type: 'keydown' | 'keyup', value: string, code = 0) => { const event = new KeyboardEvent(type, { key: value, keyCode: code, bubbles: true, cancelable: true }); document.activeElement!.dispatchEvent(event); return event }
const make = (load = vi.fn(async () => result()), save = vi.fn(), back = vi.fn()) => { ui = guideMatchUI(document.getElementById('guide-match')!, load, save, back); return { load, save, back } }

it('renders inert feed names, shows persistence and selection, and saves only on explicit choice', async () => {
  const { save, back } = make(); ui.open('My channel', 'news', true); await vi.advanceTimersByTimeAsync(0)
  expect(el('storage').textContent).toContain('Saved for this source'); expect(el('list').querySelector('b')).toBeNull()
  const choice = el('list').querySelector('button')!; expect(choice.getAttribute('aria-pressed')).toBe('true')
  choice.focus(); expect(save).not.toHaveBeenCalled(); choice.click(); expect(save).toHaveBeenCalledWith('news'); expect(back).toHaveBeenCalledOnce()
  el('automatic').click(); expect(save).toHaveBeenLastCalledWith(undefined)
})

it('aborts searches on typing/close and prevents stale responses and stale buttons from committing', async () => {
  const pending: Array<{ resolve(value: GuideChoices): void; signal: AbortSignal }> = []
  const save = vi.fn(), load = vi.fn((_query: string, _page: number, signal: AbortSignal) => new Promise<GuideChoices>(resolve => pending.push({ resolve, signal })))
  ui = guideMatchUI(document.getElementById('guide-match')!, load, save, vi.fn()); ui.open('Channel')
  const search = el<HTMLInputElement>('search'); search.value = 'new'; search.dispatchEvent(new Event('input')); expect(pending[0].signal.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(200); pending[1].resolve(result('new')); await vi.advanceTimersByTimeAsync(0)
  const stale = el('list').querySelector('button')!
  pending[0].resolve(result('old')); await vi.advanceTimersByTimeAsync(0); expect(el('list').textContent).toContain('new')
  search.value = 'next'; search.dispatchEvent(new Event('input')); stale.click(); expect(save).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200); ui.close(); expect(pending[2].signal.aborted).toBe(true)
  pending[2].resolve(result('late')); await vi.advanceTimersByTimeAsync(0); expect(el('list').childElementCount).toBe(0)
  expect(el<HTMLInputElement>('search').disabled).toBe(true); el('automatic').click(); expect(save).not.toHaveBeenCalled()
})

it('supports remote paging and prevents held OK from affecting the returned screen', async () => {
  const load = vi.fn(async (_query: string, page: number) => ({ ...result(`page-${page}`), page, total: 41, pages: 3 })), save = vi.fn()
  ui = guideMatchUI(document.getElementById('guide-match')!, load, save, () => ui.close()); ui.open('Channel'); await vi.advanceTimersByTimeAsync(0)
  el('search').focus(); key('keydown', 'PageDown'); await vi.advanceTimersByTimeAsync(0)
  expect(el('page').textContent).toBe('Page 2 of 3'); expect(document.activeElement).toBe(el('list').querySelector('button'))
  key('keydown', '', 428); await vi.advanceTimersByTimeAsync(0); expect(el('page').textContent).toBe('Page 3 of 3')
  key('keydown', 'Enter'); (document.activeElement as HTMLElement).click(); expect(save).toHaveBeenCalledWith('page-2')
  expect(key('keydown', 'Enter').defaultPrevented).toBe(true); key('keyup', 'Enter')
  expect(key('keydown', 'Enter').defaultPrevented).toBe(false)
  ui.open('Channel'); await vi.advanceTimersByTimeAsync(0); el('search').focus(); key('keydown', '', 13); await vi.advanceTimersByTimeAsync(0)
  expect(document.activeElement).toBe(el('list').querySelector('button')); window.dispatchEvent(new Event('blur'))
  expect(key('keydown', 'Enter').defaultPrevented).toBe(false)
})

it('keeps the picker open when a save fails and makes Back available after a search failure', async () => {
  const back = vi.fn(), save = vi.fn(() => { throw new Error('Storage full; previous match kept.') }), load = vi.fn(async () => result())
  make(load, save, back); ui.open('Channel'); await vi.advanceTimersByTimeAsync(0); el('list').querySelector('button')!.click()
  expect(el('status').textContent).toContain('previous match kept'); expect(back).not.toHaveBeenCalled()
  load.mockRejectedValueOnce(new Error('Guide unavailable')); el('refresh').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el('status').textContent).toBe('Guide unavailable'); el('back').click(); expect(back).toHaveBeenCalledOnce()
})

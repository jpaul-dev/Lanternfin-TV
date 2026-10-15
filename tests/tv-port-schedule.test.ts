// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { scheduleCells, scheduleUI } from '../tv-app/schedule'
import type { Channel } from '../tv-app/catalog'
import type { Programme } from '../tv-app/guide'

const half = 1800000, now = Date.UTC(2026, 9, 4, 12, 15), start = now - half / 2
const channel = (n: number): Channel => ({ name: `Channel ${n}`, url: `https://example.test/${n}.m3u8`, group: 'News', mediaKind: 'live' })
const programme = (n: number): Programme => ({ start: start + n * half, stop: start + (n + 1) * half, title: `Show ${n}`, description: `Description ${n}` })
const el = (id: string) => document.getElementById(`schedule-${id}`)!
const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const settle = () => vi.advanceTimersByTimeAsync(0)
let ui: ReturnType<typeof scheduleUI>
let options: Parameters<typeof scheduleUI>[1]
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now)
  document.body.innerHTML = '<button id="outside">Outside</button><section id="schedule"></section>'
  options = {
    channels: vi.fn(async () => Array.from({ length: 20 }, (_, n) => channel(n + 1))), categories: vi.fn(async () => [{ id: 'news', name: 'News' }]),
    programmes: vi.fn(async () => Array.from({ length: 60 }, (_, n) => programme(n - 20))), clock: () => '0',
    watch: vi.fn(), details: vi.fn(), list: vi.fn(), back: vi.fn(), sidebar: vi.fn(), invalidate: vi.fn(),
  }
})
afterEach(() => { ui?.suspend(); vi.restoreAllMocks(); vi.useRealTimers() })
async function open() { ui = scheduleUI(document.getElementById('schedule')!, options); ui.open('source'); await settle() }
const position = () => [Number((document.activeElement as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row), Number((document.activeElement as HTMLElement).dataset.cell)]

it('covers gaps, clips overlaps and ignores invalid provider times without exposing markup', () => {
  const items = [{ ...programme(0), start: start - half }, { ...programme(0), start: start + 1 }, programme(2), { ...programme(3), stop: NaN }]
  const result = scheduleCells(items, start, start + 4 * half)
  expect(result.map(cell => [cell.start - start, cell.stop - start])).toEqual([[0, half], [half, 2 * half], [2 * half, 3 * half], [3 * half, 4 * half]])
  expect(result[1].programme).toBeUndefined()
  expect(scheduleCells([], start, start + half)).toEqual([{ start, stop: start + half }])
})
it('moves by programme horizontally and preserves the same time across channels and pages', async () => {
  await open(); expect(position()).toEqual([0, 0])
  press('ArrowRight'); press('ArrowRight'); expect(position()).toEqual([0, 2])
  press('ArrowDown'); expect(position()).toEqual([1, 2]); press('ArrowUp'); expect(position()).toEqual([0, 2])
  press('PageDown'); await settle(); expect(position()).toEqual([6, 2]); expect(el('rows').children).toHaveLength(6)
  press('ArrowUp'); await settle(); expect(position()).toEqual([5, 2])
  for (let n = 0; n < 5; n++) press('PageDown')
  await settle(); expect(position()[0]).toBe(19); press('ArrowDown'); expect(position()[0]).toBe(19)
})
it('crosses schedule windows in time order and returns to Now without changing channel', async () => {
  await open(); press('ArrowDown'); press('ArrowLeft'); await settle()
  expect(position()).toEqual([1, 3]); expect(document.activeElement?.textContent).toBe('Show -1')
  press('ArrowRight'); await settle(); expect(document.activeElement?.textContent).toBe('Show 0')
  el('now').click(); await settle(); expect(position()).toEqual([1, 0])
})
it('tunes current programmes, opens future/past details, and restores channel/time after suspend', async () => {
  await open(); press('Enter'); expect(options.watch).toHaveBeenCalledWith(channel(1), expect.any(Array))
  press('ArrowRight'); press('ArrowDown'); press('Enter'); expect(options.details).toHaveBeenCalledWith(channel(2), programme(1))
  ui.suspend(); document.getElementById('outside')!.focus(); ui.resume(); await settle(); expect(position()).toEqual([1, 1])
  press('Info'); expect(options.details).toHaveBeenCalledTimes(2)
})
it('Back reaches the three main controls, then exits; menu arrows cannot escape', async () => {
  await open(); press('Escape'); expect(document.activeElement).toBe(el('category'))
  press('ArrowRight'); expect(document.activeElement).toBe(el('now')); press('ArrowDown'); expect(position()).toEqual([0, 0])
  el('more').click(); press('ArrowLeft'); expect(document.activeElement).toBe(el('find'))
  press('ArrowDown'); expect(document.activeElement).toBe(el('day-back')); press('Escape'); expect(position()).toEqual([0, 0])
  press('Escape'); press('Escape'); expect(options.back).toHaveBeenCalledOnce()
})
it('loads only visible rows with three concurrent requests, rejects stale replies, and does not steal toolbar focus', async () => {
  const replies: { signal: AbortSignal; resolve: (items: Programme[]) => void }[] = []
  options.programmes = vi.fn((_channel, signal) => new Promise(resolve => { replies.push({ signal, resolve }) }))
  await open(); expect(replies).toHaveLength(3)
  press('PageDown'); await settle(); expect(replies.slice(0, 3).every(row => row.signal.aborted)).toBe(true); expect(replies).toHaveLength(6)
  press('Escape'); replies.slice(0, 3).forEach(row => row.resolve([programme(10)])); replies.slice(3, 6).forEach(row => row.resolve([programme(0)])); await settle()
  expect(document.activeElement).toBe(el('category')); expect(el('rows').textContent).not.toContain('Show 10'); expect(replies).toHaveLength(9)
  ui.suspend(); expect(replies.slice(6).every(row => row.signal.aborted)).toBe(true)
})
it('allows tuning with missing or failed EPG and treats provider titles as text', async () => {
  options.programmes = vi.fn(async () => { throw new Error('offline') })
  options.channels = vi.fn(async () => [{ ...channel(1), name: '<img src=x onerror=alert(1)>' }])
  await open(); expect(el('rows').querySelector('img')).toBeNull(); expect(el('title').textContent).toBe('Guide unavailable')
  press('Enter'); expect(options.watch).toHaveBeenCalledOnce()
})
it('preserves focus during background library growth and clears state when changing source', async () => {
  await open(); press('ArrowDown'); press('ArrowRight'); ui.refreshChannels(); await settle(); expect(position()).toEqual([1, 1])
  document.getElementById('outside')!.focus(); ui.refreshChannels(); await settle(); expect(document.activeElement?.id).toBe('outside')
  ui.open('different'); await settle(); expect(position()).toEqual([0, 0])
})
it('chooses a category through a bounded list and returns to all channels', async () => {
  await open(); el('category').click(); await settle(); el('category-list').querySelector<HTMLButtonElement>('button')!.click(); await settle()
  expect(options.channels).toHaveBeenLastCalledWith({ id: 'news', name: 'News' }, expect.any(AbortSignal)); expect(el('category').textContent).toBe('News')
  el('category').click(); await settle(); el('all').click(); await settle(); expect(options.channels).toHaveBeenLastCalledWith(undefined, expect.any(AbortSignal))
  el('more').click(); el('refresh').click(); await settle(); expect(options.invalidate).toHaveBeenCalledOnce()
})
it('jumps to guide numbers without tuning, preserves the chosen time and cancels pending digits', async () => {
  await open(); press('ArrowRight'); press('1'); press('8'); expect(el('number').textContent).toContain('18')
  press('Enter'); await settle(); expect(position()).toEqual([17, 1]); expect(options.watch).not.toHaveBeenCalled(); expect(options.details).not.toHaveBeenCalled()
  press('4'); press('Escape'); await vi.advanceTimersByTimeAsync(1500); expect(position()).toEqual([17, 1]); expect(el('number').hidden).toBe(true)
  press('9'); press('9'); await vi.advanceTimersByTimeAsync(1200); expect(position()).toEqual([17, 1]); expect(el('number').textContent).toContain('No channel 99')
  press('2'); await vi.advanceTimersByTimeAsync(1200); expect(position()).toEqual([1, 1]); expect(options.watch).not.toHaveBeenCalled()
  press('1'); ui.suspend(); ui.open('other-source'); await vi.advanceTimersByTimeAsync(1500); expect(position()).toEqual([0, 0]); expect(el('number').hidden).toBe(true)
})
it('finds a channel inside the guide and restores its schedule without starting playback', async () => {
  await open(); press('ArrowRight'); press('ArrowRight'); el('more').click(); el('find').click(); await settle()
  const query = document.getElementById('schedule-find-query') as HTMLInputElement
  query.value = 'Channel 19'; query.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
  press('Enter'); await settle(); (document.activeElement as HTMLElement).click(); await settle()
  expect(position()).toEqual([18, 2]); expect(el('finder').hidden).toBe(true); expect(options.watch).not.toHaveBeenCalled()
  el('more').click(); el('find').click(); await settle(); press('Escape'); expect(position()).toEqual([18, 2])
})

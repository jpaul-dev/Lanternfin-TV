// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { guideChannelPage, guideFinder } from '../tv-app/guide-finder'
import type { Channel } from '../tv-app/catalog'

const channel = (index: number): Channel => ({ name: `Channel ${index}`, url: `https://example.test/${index}`, group: 'News', mediaKind: 'live' })
const signal = () => new AbortController().signal
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('finds names through a 120,000-channel catalog while retaining only one result page', async () => {
  const channels = Array.from({ length: 120000 }, (_, index) => channel(index + 1))
  const result = await guideChannelPage(channels, ' cHaNnEl 12 ', 0, signal())
  expect(result.total).toBe(1112); expect(result.indices).toHaveLength(16); expect(result.indices[0]).toBe(11)
  const last = await guideChannelPage(channels, 'Channel 12', 99999, signal())
  expect(last.page).toBe(last.pages - 1); expect(last.indices.at(-1)).toBe(119999)
  expect(await guideChannelPage(channels, '120000', 9, signal())).toEqual({ indices: [119999], total: 1, page: 0, pages: 1 })
  expect((await guideChannelPage(channels, '120001', 0, signal())).total).toBe(0)
  expect((await guideChannelPage(channels, '', -4, signal())).indices).toEqual(Array.from({ length: 16 }, (_, index) => index))
})

it('yields during a large search and cancels before publishing a partial page', async () => {
  vi.useFakeTimers(); let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 10)
  const abort = new AbortController(), channels = Array.from({ length: 10000 }, (_, index) => channel(index))
  const result = guideChannelPage(channels, 'Channel', 0, abort.signal), rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort(); await vi.advanceTimersByTimeAsync(0); await rejection
})

it('pages with arrows, traps focus, preserves input editing and discards old choices after catalog replacement', async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<button id="outside">Outside</button><div id="finder" hidden></div>'
  let channels = Array.from({ length: 35 }, (_, index) => channel(index + 1))
  const choose = vi.fn(), back = vi.fn(), ui = guideFinder(document.getElementById('finder')!, { channels: () => channels, scope: () => 'News', choose, back })
  const el = (id: string) => document.getElementById(`schedule-find-${id}`)!, query = el('query') as HTMLInputElement
  const press = (key: string, extra = {}) => { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }); document.activeElement!.dispatchEvent(event); return event }
  ui.open(); await vi.advanceTimersByTimeAsync(0)
  expect(document.activeElement).toBe(query); expect(el('scope').textContent).toContain('News')
  expect(press('ArrowLeft').defaultPrevented).toBe(false); press('ArrowDown'); expect((document.activeElement as HTMLElement).dataset.index).toBe('0')
  for (let i = 0; i < 16; i++) press('ArrowDown')
  await vi.advanceTimersByTimeAsync(0); expect((document.activeElement as HTMLElement).dataset.index).toBe('16')
  press('ArrowUp'); await vi.advanceTimersByTimeAsync(0); expect((document.activeElement as HTMLElement).dataset.index).toBe('15')
  press('PageDown'); await vi.advanceTimersByTimeAsync(0); expect(el('page').textContent).toBe('2 / 3')
  const old = document.activeElement as HTMLButtonElement; channels = [channel(77)]; ui.refresh(); old.click(); expect(choose).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0); expect(document.activeElement?.textContent).toBe('1Channel 77'); (document.activeElement as HTMLElement).click(); expect(choose).toHaveBeenCalledWith(channels[0], 0)
  el('back').focus(); press('Tab'); expect(document.activeElement).toBe(query); press('Escape'); expect(back).toHaveBeenCalledOnce()
  query.value = 'missing'; query.dispatchEvent(new Event('input')); ui.close(); await vi.advanceTimersByTimeAsync(200)
  expect(el('results').children).toHaveLength(0); expect(document.getElementById('finder')!.hidden).toBe(true); expect(vi.getTimerCount()).toBe(0)
})

it('debounces names, handles IME input, keeps provider markup inert and reports empty matches', async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<div id="finder"></div>'
  const channels = [{ ...channel(1), name: '<img src=x> News' }, channel(2)]
  let incomplete = true
  const ui = guideFinder(document.getElementById('finder')!, { channels: () => channels, scope: () => 'All channels', incomplete: () => incomplete, choose: vi.fn(), back: vi.fn() })
  ui.open(); await vi.advanceTimersByTimeAsync(0)
  expect(document.getElementById('schedule-find-status')?.textContent).toContain('Library incomplete')
  incomplete = false; ui.refresh(); await vi.advanceTimersByTimeAsync(0)
  const query = document.getElementById('schedule-find-query') as HTMLInputElement, results = document.getElementById('schedule-find-results')!
  expect(results.querySelector('img')).toBeNull(); query.value = 'missing'; query.dispatchEvent(new InputEvent('input', { isComposing: true })); await vi.advanceTimersByTimeAsync(200); expect(results.children).toHaveLength(2)
  query.value = 'News'; query.dispatchEvent(new CompositionEvent('compositionend')); await vi.advanceTimersByTimeAsync(200); expect(results.children).toHaveLength(1); expect(document.activeElement).toBe(query)
  query.value = 'not present'; query.dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
  expect(document.getElementById('schedule-find-status')?.textContent).toBe('No matching channels'); expect(results.children).toHaveLength(0)
  ui.close()
})

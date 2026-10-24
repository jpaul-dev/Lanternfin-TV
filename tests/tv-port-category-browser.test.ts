// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { categoryBrowser, categoryPage, playlistCategories } from '../tv-app/category-browser'
import { groupPicker } from '../tv-app/group-picker'
import type { Channel } from '../tv-app/catalog'

const entries = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Category ${String(i).padStart(5, '0')}` }))
const channels = (count: number): Channel[] => entries(count).map(entry => ({ name: 'Title', group: entry.name, url: `https://example.com/${entry.id}.mp4`, mediaKind: 'movie' }))
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const modal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'), close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''
  for (const [key, descriptor] of [['showModal', modal], ['close', close]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
    else delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[key]
  }
})

it('counts a large directory while retaining only a page, clamps removed pages and follows stable category IDs', async () => {
  const directory = entries(10000), signal = new AbortController().signal
  const last = await categoryPage(directory, '', 624, signal)
  expect(last).toMatchObject({ total: 10000, page: 624, pages: 625 }); expect(last.items).toHaveLength(16); expect(last.items.at(-1)?.id).toBe('9999')
  expect(await categoryPage(directory, '9999', 300, signal)).toEqual({ items: [directory[9999]], total: 1, page: 0, pages: 1 })
  expect(await categoryPage(directory, '', 0, signal, '9999')).toEqual(last)
  expect(await categoryPage(directory, 'not present', 7, signal)).toEqual({ items: [], total: 0, page: 0, pages: 0 })
  expect((await categoryPage(directory, '', Infinity, signal)).page).toBe(0)
})

it('deduplicates playlist groups within their content kind and cancels either large directory pass', async () => {
  const input = channels(10000), signal = new AbortController().signal
  input.push({ ...input[0], mediaKind: 'live' }, { ...input[0], group: '<script>inert</script>', mediaKind: 'episode' })
  expect(await playlistCategories(input, signal, 'series')).toEqual([{ id: '<script>inert</script>', name: '<script>inert</script>' }])
  expect(await playlistCategories(input, signal, 'live')).toEqual([{ id: 'Category 00000', name: 'Category 00000' }])
  expect(await playlistCategories(input, signal, 'movie')).toHaveLength(10000)
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 11)
  const aborted = new AbortController(), collecting = playlistCategories(input, aborted.signal); aborted.abort(); await expect(collecting).rejects.toThrow('cancelled')
  const cancelled = new AbortController(), searching = categoryPage(entries(10000), 'Category', 0, cancelled.signal); cancelled.abort(); await expect(searching).rejects.toThrow('cancelled')
})

it('renders bounded pages, searches all names, rejects stale choices, and preserves focus through refresh', async () => {
  vi.useFakeTimers(); document.body.innerHTML = '<aside id="categories"><div id="list"></div></aside>'
  let selected = '18'; const chosen = vi.fn(entry => selected = entry.id), ui = categoryBrowser(el('categories'), el('list'), 'category', () => selected)
  await ui.set(entries(10000), chosen, undefined, selected)
  expect(el('list').children).toHaveLength(16); expect(el('category-page').textContent).toBe('2 / 625')
  expect(el('list').querySelector('[aria-pressed=true]')?.textContent).toBe('Category 00018')
  const old = el('list').children[0] as HTMLButtonElement
  el<HTMLInputElement>('category-search').value = '09999'; el('category-search').dispatchEvent(new Event('input')); old.click()
  await vi.advanceTimersByTimeAsync(200)
  expect(chosen).not.toHaveBeenCalled(); expect(el('list').children).toHaveLength(1); expect(el('list').textContent).toBe('Category 09999')
  ;(el('list').children[0] as HTMLButtonElement).focus(); (el('list').children[0] as HTMLButtonElement).click()
  expect(chosen).toHaveBeenLastCalledWith({ id: '9999', name: 'Category 09999' })
  expect(ui.position).toEqual({ query: '09999', page: 0 })
  await ui.set(entries(10000), chosen, ui.position); expect(document.activeElement?.textContent).toBe('Category 09999')
  el<HTMLInputElement>('category-search').value = ''; el('category-search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
  el('category-next').click(); await vi.advanceTimersByTimeAsync(0); expect(el('category-page').textContent).toBe('2 / 625'); expect(document.activeElement?.textContent).toBe('Category 00016')
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })); await vi.advanceTimersByTimeAsync(0)
  expect(el('category-page').textContent).toBe('3 / 625')
  ui.suspend(); (el('list').children[0] as HTMLButtonElement).click(); expect(chosen).toHaveBeenCalledTimes(1)
  ui.resume(); await vi.advanceTimersByTimeAsync(0); expect(el('list').children).toHaveLength(16)
  ui.dispose()
})

it('does not let cancelled directory scans replace a new source or activate its old buttons', async () => {
  document.body.innerHTML = '<aside id="categories"><div id="list"></div></aside>'
  const chosen = vi.fn(), ui = categoryBrowser(el('categories'), el('list'), 'category', () => '')
  await ui.set(entries(50), chosen)
  const old = el('list').children[0] as HTMLButtonElement
  let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 11)
  const first = ui.set(entries(100000), chosen, { query: 'Category', page: 0 }), last = ui.set([{ id: 'new', name: '<img onerror=unsafe> New source' }], chosen)
  old.click(); await Promise.all([first, last])
  expect(el('list').children).toHaveLength(1); expect(el('list').textContent).toBe('<img onerror=unsafe> New source'); expect(el('list').querySelector('img')).toBeNull()
  expect(chosen).not.toHaveBeenCalled(); (el('list').children[0] as HTMLButtonElement).click(); expect(chosen).toHaveBeenCalledWith({ id: 'new', name: '<img onerror=unsafe> New source' })
  ui.dispose()
})

it('uses at most two native options for huge lists, supports search/Back/All groups and keeps removed selections explicit', async () => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  document.body.innerHTML = '<label for="group">Category</label><select id="group"><option value="">All groups</option></select>'
  const select = el<HTMLSelectElement>('group'), changed = vi.fn(); select.onchange = changed
  const ui = groupPicker(select); await ui.refresh(channels(10000)); expect(select.options).toHaveLength(1); expect(select.hidden).toBe(true)
  ui.value('Category 09999'); expect(select.options).toHaveLength(2)
  el('group-open').click(); await vi.advanceTimersByTimeAsync(0)
  expect(el<HTMLDialogElement>('group-picker').open).toBe(true); expect(el('group-page').textContent).toBe('625 / 625'); expect(el('group-list').children).toHaveLength(16)
  el<HTMLInputElement>('group-search').value = '09998'; el('group-search').dispatchEvent(new Event('input')); await vi.advanceTimersByTimeAsync(200)
  // Browsers may run the completed search's microtask between event listeners.
  // Simulate the focus move before the same key reaches the dialog handler.
  el('group-search').addEventListener('keydown', () => (el('group-list').children[0] as HTMLButtonElement).focus(), { once: true })
  el('group-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await vi.advanceTimersByTimeAsync(0)
  expect(select.value).toBe('Category 09999'); expect(el<HTMLDialogElement>('group-picker').open).toBe(true); expect(changed).not.toHaveBeenCalled()
  el('group-search').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  ;(el('group-list').children[0] as HTMLButtonElement).focus()
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(select.value).toBe('Category 09998'); expect(select.options).toHaveLength(2); expect(changed).toHaveBeenCalledOnce()
  expect(el<HTMLDialogElement>('group-picker').open).toBe(false); expect(document.activeElement?.id).toBe('group-open')
  const held = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }); el('group-open').dispatchEvent(held); expect(held.defaultPrevented).toBe(true)
  el('group-open').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  el('group-open').click(); await vi.advanceTimersByTimeAsync(0)
  el('group-search').dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true, cancelable: true })); expect(select.value).toBe('Category 09998')
  expect(el<HTMLDialogElement>('group-picker').open).toBe(false)
  await ui.refresh(channels(300)); expect(select.value).toBe('Category 09998'); expect(el('group-open').textContent).toBe('Category 09998')
  el('group-open').click(); await vi.advanceTimersByTimeAsync(0); el('group-all').click(); expect(select.value).toBe(''); expect(changed).toHaveBeenCalledTimes(2)
  await ui.refresh(channels(5)); expect(select.hidden).toBe(false); expect(select.options).toHaveLength(6); expect(el('group-open').hidden).toBe(true)
  ui.dispose()
})

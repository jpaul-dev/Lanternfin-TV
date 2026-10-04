import type { Channel } from './catalog'
import { keyAction } from './remote'
import { tr } from './i18n'

export const GUIDE_FIND_PAGE = 16
const cancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError') }
/** Retain one page of indices, not another copy of a large channel catalog. */
export async function guideChannelPage(channels: readonly Channel[], query: string, requested: number, signal: AbortSignal): Promise<{ indices: number[]; total: number; page: number; pages: number }> {
  cancelled(signal)
  const needle = query.trim().slice(0, 200).toLocaleLowerCase()
  const numeric = /^\d+$/.test(needle), number = numeric ? Number(needle) - 1 : -1
  if (numeric) return { indices: Number.isSafeInteger(number) && number >= 0 && number < channels.length ? [number] : [], total: number >= 0 && number < channels.length ? 1 : 0, page: 0, pages: number >= 0 && number < channels.length ? 1 : 0 }
  let page = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0
  if (!needle) {
    const pages = Math.ceil(channels.length / GUIDE_FIND_PAGE); page = Math.min(page, Math.max(0, pages - 1))
    return { indices: Array.from({ length: Math.min(GUIDE_FIND_PAGE, Math.max(0, channels.length - page * GUIDE_FIND_PAGE)) }, (_, index) => page * GUIDE_FIND_PAGE + index), total: channels.length, page, pages }
  }
  const indices: number[] = []; let total = 0, started = performance.now()
  for (let index = 0; index < channels.length; index++) {
    if (channels[index].name.toLocaleLowerCase().includes(needle)) {
      if (total >= page * GUIDE_FIND_PAGE && indices.length < GUIDE_FIND_PAGE) indices.push(index)
      total++
    }
    if (index % 512 === 0 && performance.now() - started >= 8) { await new Promise<void>(resolve => setTimeout(resolve, 0)); cancelled(signal); started = performance.now() }
  }
  cancelled(signal)
  const pages = Math.ceil(total / GUIDE_FIND_PAGE), resolved = Math.min(page, Math.max(0, pages - 1))
  if (resolved !== page) return guideChannelPage(channels, query, resolved, signal)
  return { indices, total, page, pages }
}

export function guideFinder(root: HTMLElement, options: {
  channels(): readonly Channel[]; scope(): string; incomplete?(): boolean; choose(channel: Channel, index: number): void; back(): void
}) {
  root.innerHTML = `<section class="guide-finder-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-find-title"><h2 id="schedule-find-title">Find a channel</h2><p id="schedule-find-scope" class="hint"></p><label for="schedule-find-query">Channel name or guide number</label><input id="schedule-find-query" type="search" maxlength="200" autocomplete="off" spellcheck="false"><p id="schedule-find-status" class="hint" role="status"></p><div id="schedule-find-results"></div><div class="guide-finder-pages"><button id="schedule-find-previous">Previous page</button><span id="schedule-find-page"></span><button id="schedule-find-next">Next page</button></div><button id="schedule-find-back">Back to guide</button></section>`
  const el = (id: string) => root.querySelector<HTMLElement>(`#schedule-find-${id}`)!
  const query = el('query') as HTMLInputElement, list = el('results'), status = el('status')
  const previous = el('previous') as HTMLButtonElement, next = el('next') as HTMLButtonElement
  let active = false, page = 0, pages = 0, generation = 0, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const focus = (node?: HTMLElement | null) => { node?.focus({ preventScroll: true }); node?.scrollIntoView?.({ block: 'nearest' }) }
  const cancel = () => { generation++; controller?.abort(); controller = undefined; clearTimeout(timer); timer = undefined }
  const results = () => [...list.querySelectorAll<HTMLButtonElement>('button')]
  async function search(takeFocus: 'first' | 'last' | false = false) {
    cancel(); if (!active) return
    const token = generation, request = new AbortController(), channels = options.channels(); controller = request
    const ownedFocus = list.contains(document.activeElement), index = (document.activeElement as HTMLElement)?.dataset.index
    previous.disabled = next.disabled = true; list.setAttribute('aria-busy', 'true'); status.textContent = tr('Finding channels…')
    for (const button of results()) button.disabled = true
    try {
      const result = await guideChannelPage(channels, query.value, page, request.signal)
      if (!active || token !== generation || channels !== options.channels()) return
      page = result.page; pages = result.pages
      const fragment = document.createDocumentFragment()
      for (const index of result.indices) {
        const button = document.createElement('button'), number = document.createElement('small'), name = document.createElement('span')
        button.type = 'button'; button.dataset.index = String(index); number.textContent = String(index + 1); name.textContent = channels[index].name; name.dir = 'auto'; button.append(number, name)
        button.onclick = () => { if (active && token === generation && channels === options.channels()) options.choose(channels[index], index) }
        fragment.append(button)
      }
      list.replaceChildren(fragment); status.textContent = (result.total ? tr(result.total === 1 ? '{count} channel' : '{count} channels', { count: result.total.toLocaleString() }) : tr('No matching channels')) + (options.incomplete?.() ? ' · ' + tr('Library incomplete. Search covers loaded channels only.') : '')
      el('page').textContent = pages ? `${page + 1} / ${pages}` : '0 / 0'; previous.disabled = !page; next.disabled = page + 1 >= pages
      if (takeFocus || ownedFocus) { const buttons = results(); focus((!takeFocus && buttons.find(button => button.dataset.index === index)) || buttons[takeFocus === 'last' ? buttons.length - 1 : 0] || query) }
    } catch { if (active && token === generation) { list.replaceChildren(); status.textContent = tr('Channel search failed. Change the search and try again.') } }
    finally { if (token === generation) { controller = undefined; list.setAttribute('aria-busy', 'false') } }
  }
  function turn(delta: number, last = false) { if (controller || page + delta < 0 || page + delta >= pages) return; page += delta; void search(last ? 'last' : 'first') }
  const changed = () => { cancel(); page = pages = 0; list.replaceChildren(); previous.disabled = next.disabled = true; el('page').textContent = ''; status.textContent = tr('Finding channels…'); timer = setTimeout(() => { void search() }, 180) }
  query.oninput = event => { if (!(event as InputEvent).isComposing) changed() }
  query.addEventListener('compositionend', changed)
  previous.onclick = () => turn(-1); next.onclick = () => turn(1); el('back').onclick = options.back
  root.addEventListener('keydown', event => {
    if (!active || event.isComposing) return
    const action = keyAction(event.key, event.keyCode), target = document.activeElement as HTMLElement
    if (action === 'back') { event.preventDefault(); event.stopPropagation(); options.back(); return }
    if (event.key === 'Tab') {
      const controls = [...root.querySelectorAll<HTMLElement>('input,button:not(:disabled)')]; event.preventDefault(); event.stopPropagation(); focus(controls[(controls.indexOf(target) + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]); return
    }
    if (target === query && (event.key === 'Enter' || event.keyCode === 13)) { event.preventDefault(); event.stopPropagation(); void search('first'); return }
    if (action === 'channel-up' || action === 'channel-down') { event.preventDefault(); event.stopPropagation(); turn(action === 'channel-up' ? -1 : 1); return }
    if (!['up', 'down', 'left', 'right'].includes(action)) return
    event.stopPropagation()
    if (target === query && ['left', 'right'].includes(action)) return
    event.preventDefault()
    const buttons = results(), index = buttons.indexOf(target as HTMLButtonElement)
    if (action === 'up' || action === 'down') {
      if (index >= 0) {
        if (action === 'up' && !index) { if (page) turn(-1, true); else focus(query) }
        else if (action === 'down' && index === buttons.length - 1) { if (page + 1 < pages) turn(1); else focus(el('back')) }
        else focus(buttons[index + (action === 'down' ? 1 : -1)])
      } else if (target === query) { if (action === 'down') focus(buttons[0] || el('back')) }
      else focus(action === 'up' ? buttons[buttons.length - 1] || query : el('back'))
    } else if (target === previous || target === next) {
      const other = target === previous ? next : previous; if (!other.disabled) focus(other)
    }
  })
  return {
    get visible() { return active },
    open() { active = true; root.hidden = false; query.value = ''; page = pages = 0; el('scope').textContent = tr('Search {category}. Numbers match this guide view; choosing a result moves to its schedule.', { category: options.scope() }); focus(query); void search() },
    refresh() { if (active) void search() },
    close() { cancel(); active = false; root.hidden = true; query.value = ''; list.replaceChildren(); list.setAttribute('aria-busy', 'false') },
  }
}

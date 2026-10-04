import type { Channel } from './catalog'
import type { Category } from './xtream'
import { categoryBrowser } from './category-browser'
import { guideDate, timeRange, type Programme, type GuideWindow } from './guide'
import { keyAction } from './remote'
import { tr } from './i18n'

const HALF_HOUR = 1800000, DAY = 86400000
type Cell = { start: number; stop: number; programme?: Programme }
type Row = { channel: Channel; cells: Cell[]; pending: boolean; failed: boolean }
type Options = {
  channels(category: Category | undefined, signal: AbortSignal): Promise<Channel[]>
  categories(signal: AbortSignal): Promise<Category[]>
  programmes(channel: Channel, signal: AbortSignal, window: GuideWindow): Promise<Programme[]>
  clock(): string
  watch(channel: Channel, channels: Channel[]): void
  details(channel: Channel, programme: Programme): void
  list(): void
  back(): void
  sidebar(): void
  invalidate?(): void
}

/** Clip overlaps and fill gaps so every channel has a selectable cell at every time. */
export function scheduleCells(items: Programme[], from: number, to: number): Cell[] {
  const cells: Cell[] = []; let cursor = from
  for (const item of items.slice().sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.stop) || item.stop <= cursor || item.start >= to || item.stop <= item.start) continue
    if (cells.length >= 95) break
    if (item.start > cursor) cells.push({ start: cursor, stop: Math.min(item.start, to) })
    const stop = Math.min(item.stop, to)
    cells.push({ start: Math.max(cursor, item.start), stop, programme: item }); cursor = stop
    if (cursor >= to) break
  }
  if (cursor < to) cells.push({ start: cursor, stop: to })
  return cells
}

/** A bounded, remote-first channel/time grid. Only the visible channel page requests EPG. */
export function scheduleUI(root: HTMLElement, options: Options) {
  root.innerHTML = `<div class="schedule-heading"><div><p class="eyebrow">LIVE TV</p><h1>TV Guide</h1></div><div class="schedule-toolbar"><button id="schedule-category">All channels</button><button id="schedule-now">Now</button><button id="schedule-more">More</button></div></div>
    <div id="schedule-summary"><p id="schedule-meta"></p><h2 id="schedule-title"></h2><p id="schedule-description"></p></div>
    <div id="schedule-board"><div class="schedule-times"><span id="schedule-date"></span><div id="schedule-hours"></div></div><div id="schedule-rows" aria-label="Channels and programmes"></div></div>
    <div class="schedule-bottom"><span id="schedule-status" role="status"></span><span>↑ ↓ Channels · ← → Schedule · OK Watch / details · Back Controls</span></div>
    <section id="schedule-options" class="schedule-dialog" hidden aria-label="Guide options"><h2>Guide options</h2><button id="schedule-day-back">Previous day</button><button id="schedule-day-next">Next day</button><button id="schedule-refresh">Refresh guide</button><button id="schedule-list">Channel list &amp; guide settings</button><button id="schedule-options-back">Back to guide</button></section>
    <section id="schedule-categories" class="schedule-dialog" hidden aria-label="Channel categories"><h2>Channel categories</h2><button id="schedule-categories-back">Back to guide</button><button id="schedule-all">All channels</button><p id="schedule-category-status" role="status"></p><div id="schedule-category-list"></div></section>`
  const el = (id: string) => root.querySelector<HTMLElement>(`#schedule-${id}`)!
  const btn = (id: string) => el(id) as HTMLButtonElement
  const categoryPicker = categoryBrowser(el('categories'), el('category-list'), 'schedule-group', () => category?.id)
  let source = '', category: Category | undefined, channels: Channel[] = [], selected = 0, first = 0, count = 6
  let from = 0, span = 4 * HALF_HOUR, anchor = Date.now(), channelColumn = false, followsNow = true, rows: Row[] = []
  let active = false, controller: AbortController | undefined, channelLoad: AbortController | undefined, categoryLoad: AbortController | undefined
  let timer: ReturnType<typeof setInterval> | undefined, version = 0, loadingChannels = false
  const focus = (node?: HTMLElement | null) => node?.focus({ preventScroll: true })
  const clock = (time: number) => timeRange({ start: time, stop: time, title: '', description: '' }, options.clock()).split(' – ')[0]
  const selectedRow = () => rows[selected - first]
  const cellIndex = (row = selectedRow()) => Math.max(0, row?.cells.findIndex(cell => cell.start <= anchor && cell.stop > anchor) ?? 0)
  const selection = () => el('rows').querySelector<HTMLElement>(`[data-row="${selected}"] [data-cell="${channelColumn ? -1 : cellIndex()}"]`)
  const focusSelection = () => focus(selection() || btn('category'))
  function summary() {
    const row = selectedRow(), cell = row?.cells[cellIndex()], programme = cell?.programme
    el('meta').textContent = row ? `${selected + 1} · ${row.channel.name}${programme ? ` · ${timeRange(programme, options.clock())}` : ''}` : tr('Your channels, at a glance')
    el('title').textContent = programme?.title || (row?.pending ? tr('Loading guide…') : row ? tr(row.failed ? 'Guide unavailable' : 'No programme information') : tr(loadingChannels ? 'Loading channels…' : 'Choose a channel category'))
    el('description').textContent = programme?.description || (row ? tr('Press OK to watch this channel. Programme information depends on your provider.') : tr('Open Categories to choose channels, or use the channel list to search.'))
    const now = Date.now()
    for (const node of el('rows').querySelectorAll<HTMLElement>('[data-start]')) node.classList.toggle('on-now', Number(node.dataset.start) <= now && Number(node.dataset.stop) > now)
    for (const line of el('rows').querySelectorAll<HTMLElement>('.schedule-now-line')) { line.hidden = now < from || now >= from + span; line.style.left = `${(now - from) / span * 100}%` }
  }
  function heading() {
    el('date').textContent = guideDate(from, options.clock())
    btn('category').textContent = category?.name || tr('All channels')
    el('hours').replaceChildren()
    for (let time = from; time < from + span; time += HALF_HOUR) {
      const label = document.createElement('span'); label.textContent = clock(time); label.style.width = `${HALF_HOUR / span * 100}%`; el('hours').append(label)
    }
    el('status').textContent = loadingChannels ? tr('Loading channels…') : channels.length ? `${first + 1}–${Math.min(first + count, channels.length)} / ${channels.length.toLocaleString()} · ${tr('Page / Channel keys: next page')}` : tr('No channels in this view')
  }
  function rowElement(row: Row, index: number) {
    const node = document.createElement('div'); node.className = 'schedule-row'; node.dataset.row = String(index)
    const channel = document.createElement('button'); channel.className = 'schedule-channel'; channel.dataset.cell = '-1'
    const number = document.createElement('small'); number.textContent = String(index + 1)
    const name = document.createElement('span'); name.textContent = row.channel.name; name.dir = 'auto'; channel.append(number, name)
    channel.setAttribute('aria-label', `${index + 1}. ${row.channel.name}. ${tr('Watch')}`)
    channel.onclick = () => { selected = index; channelColumn = true; options.watch(row.channel, channels) }; node.append(channel)
    const timeline = document.createElement('div'); timeline.className = 'schedule-timeline'; timeline.setAttribute('aria-busy', String(row.pending))
    row.cells.forEach((cell, cellNumber) => {
      const button = document.createElement('button'); button.dataset.cell = String(cellNumber); button.className = 'schedule-cell'
      button.style.left = `${(cell.start - from) / span * 100}%`; button.style.width = `${(cell.stop - cell.start) / span * 100}%`
      button.dataset.start = String(cell.programme?.start ?? cell.start); button.dataset.stop = String(cell.programme?.stop ?? cell.stop)
      const title = document.createElement('span'); title.dir = 'auto'; title.textContent = cell.programme?.title || tr(row.pending ? 'Loading…' : row.failed ? 'Guide unavailable' : 'No information'); button.append(title)
      button.setAttribute('aria-label', `${row.channel.name}. ${title.textContent}. ${timeRange(cell.programme || { ...cell, title: '', description: '' }, options.clock())}`)
      button.onclick = () => { selected = index; channelColumn = false; anchor = Math.max(cell.start, Math.min(anchor, cell.stop - 1)); if (cell.programme && (cell.programme.start > Date.now() || cell.programme.stop <= Date.now())) followsNow = false; activate(false) }
      timeline.append(button)
    })
    const now = Date.now(); if (now >= from && now < from + span) { const line = document.createElement('i'); line.className = 'schedule-now-line'; line.style.left = `${(now - from) / span * 100}%`; timeline.append(line) }
    node.append(timeline); return node
  }
  function replaceRow(index: number) {
    const previous = el('rows').querySelector<HTMLElement>(`[data-row="${index}"]`), ownsFocus = previous?.contains(document.activeElement)
    const row = rows[index - first]; if (!row || !previous) return
    previous.replaceWith(rowElement(row, index)); if (ownsFocus) focusSelection(); summary()
  }
  function measure() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 20
    const height = el('rows').getBoundingClientRect().height
    count = Math.max(2, Math.min(8, Math.floor((height || rem * 19) / (rem * 2.8))))
    span = root.clientWidth && root.clientWidth / rem < 36 ? 3 * HALF_HOUR : 4 * HALF_HOUR
  }
  function cancelGuide() { version++; controller?.abort(); controller = undefined }
  function render(takeFocus: boolean) {
    cancelGuide(); if (!active) return
    selected = Math.max(0, Math.min(selected, channels.length - 1)); first = Math.floor(selected / count) * count
    anchor = Math.max(from, Math.min(from + span - 1, anchor))
    rows = channels.slice(first, first + count).map(channel => ({ channel, cells: scheduleCells([], from, from + span), pending: true, failed: false }))
    el('rows').replaceChildren(...rows.map((row, n) => rowElement(row, first + n))); heading(); summary(); if (takeFocus) focusSelection()
    const request = new AbortController(), token = version; controller = request; let cursor = 0
    const window = { fromMs: from, toMs: from + span }
    const worker = async () => {
      while (active && !request.signal.aborted && token === version && cursor < rows.length) {
        const index = cursor++, row = rows[index]; let items: Programme[] = [], failed = false
        try { items = await options.programmes(row.channel, request.signal, window) } catch { failed = true }
        if (!active || request.signal.aborted || token !== version) return
        row.pending = false; row.failed = failed; row.cells = scheduleCells(items, from, from + span); replaceRow(first + index)
      }
    }
    void Promise.all([worker(), worker(), worker()])
  }
  async function loadChannels(takeFocus: boolean) {
    channelLoad?.abort(); cancelGuide(); const request = new AbortController(); channelLoad = request; loadingChannels = true; heading(); summary()
    try {
      const result = await options.channels(category, request.signal)
      if (!active || request.signal.aborted || channelLoad !== request) return
      const old = channels[selected], position = old ? result.findIndex(channel => channel.url === old.url && channel.name === old.name) : -1
      const ownsFocus = el('rows').contains(document.activeElement)
      channels = result; selected = Math.max(0, position); loadingChannels = false; render(ownsFocus || takeFocus && el('options').hidden && el('categories').hidden && (root.contains(document.activeElement) || document.activeElement === document.body))
    } catch {
      if (!request.signal.aborted && channelLoad === request) { loadingChannels = false; el('status').textContent = tr('Channels unavailable. Open Categories or choose Refresh guide to retry.') }
    } finally { if (channelLoad === request) channelLoad = undefined }
  }
  function shift(delta: number, takeFocus = true) {
    followsNow = false
    const now = Date.now(), next = Math.max(Math.floor((now - 7 * DAY) / HALF_HOUR) * HALF_HOUR, Math.min(Math.floor((now + 2 * DAY) / HALF_HOUR) * HALF_HOUR, from + delta))
    if (next === from) return
    anchor = delta < 0 ? next + span - 1 : next; from = next; channelColumn = false; render(takeFocus)
  }
  function activate(details: boolean) {
    const row = selectedRow(), programme = row?.cells[cellIndex()]?.programme
    if (!row) return
    if (programme && (details || programme.start > Date.now() || programme.stop <= Date.now())) options.details(row.channel, programme)
    else options.watch(row.channel, channels)
  }
  function closePanel() { el('options').hidden = el('categories').hidden = true; categoryPicker.suspend(); categoryLoad?.abort(); focusSelection() }
  const translate = () => { for (const id of ['now', 'more', 'day-back', 'day-next', 'refresh', 'list', 'options-back', 'categories-back', 'all']) { const node = btn(id); node.textContent = tr(node.dataset.label || (node.dataset.label = node.textContent || '')) } }
  btn('now').onclick = () => { followsNow = true; anchor = Date.now(); from = Math.floor(anchor / HALF_HOUR) * HALF_HOUR; channelColumn = false; render(true) }
  btn('more').onclick = () => { el('options').hidden = false; focus(btn('day-back')) }
  btn('options-back').onclick = btn('categories-back').onclick = closePanel
  btn('day-back').onclick = () => { closePanel(); shift(-DAY) }; btn('day-next').onclick = () => { closePanel(); shift(DAY) }
  btn('refresh').onclick = () => { options.invalidate?.(); closePanel(); void loadChannels(true) }
  btn('list').onclick = options.list
  btn('all').onclick = () => { category = undefined; channels = []; selected = 0; closePanel(); render(false); void loadChannels(true) }
  btn('category').onclick = async () => {
    el('categories').hidden = false; categoryPicker.clear(); focus(btn('categories-back')); el('category-status').textContent = tr('Loading categories…')
    categoryLoad?.abort(); const request = new AbortController(); categoryLoad = request
    try {
      const categories = await options.categories(request.signal)
      if (!active || request.signal.aborted || categoryLoad !== request) return
      el('category-status').textContent = ''
      await categoryPicker.set(categories, choice => { category = choice; channels = []; selected = 0; closePanel(); render(false); void loadChannels(true) })
    } catch { if (!request.signal.aborted) el('category-status').textContent = tr('Categories unavailable. Return to the guide and try again.') }
  }
  el('rows').addEventListener('focusin', event => {
    const node = event.target as HTMLElement, parent = node.closest<HTMLElement>('[data-row]')
    if (!parent || node.dataset.cell === undefined) return
    selected = Number(parent.dataset.row); channelColumn = node.dataset.cell === '-1'
    const cell = selectedRow()?.cells[Number(node.dataset.cell)]
    if (cell && !(anchor >= cell.start && anchor < cell.stop)) anchor = cell.start
    summary()
  })
  root.addEventListener('keydown', event => {
    if (!active || event.isComposing) return
    const action = keyAction(event.key, event.keyCode), target = document.activeElement as HTMLElement
    const panel = !el('categories').hidden ? el('categories') : !el('options').hidden ? el('options') : undefined
    if (panel) {
      if (action === 'back') { event.preventDefault(); event.stopPropagation(); closePanel(); return }
      if (target instanceof HTMLInputElement && ['left', 'right'].includes(action)) return
      if (event.key === 'Tab') { const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input')].filter(node => !node.closest('[hidden]')); event.preventDefault(); event.stopPropagation(); focus(items[(items.indexOf(target) + (event.shiftKey ? -1 : 1) + items.length) % items.length]); return }
      if (['up', 'down', 'left', 'right'].includes(action)) {
        event.preventDefault(); event.stopPropagation()
        if (action === 'up' || action === 'down') { const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input')].filter(node => !node.closest('[hidden]')); focus(items[Math.max(0, Math.min(items.length - 1, items.indexOf(target) + (action === 'up' ? -1 : 1)))]) }
      }
      return
    }
    const inRows = !!target.closest('#schedule-rows'), toolbar = [btn('category'), btn('now'), btn('more')]
    if (action === 'back') { event.preventDefault(); event.stopPropagation(); if (inRows) focus(btn('category')); else options.back(); return }
    if (!inRows) {
      if (action === 'down') { event.preventDefault(); event.stopPropagation(); focusSelection() }
      else if (action === 'left' || action === 'right') {
        event.preventDefault(); event.stopPropagation(); const step = (action === 'left' ? -1 : 1) * (document.documentElement.dir === 'rtl' ? -1 : 1), next = toolbar.indexOf(target as HTMLButtonElement) + step
        if (next < 0) options.sidebar(); else focus(toolbar[Math.min(toolbar.length - 1, next)])
      }
      return
    }
    if (!['up', 'down', 'left', 'right', 'channel-up', 'channel-down', 'info'].includes(action) && event.key !== 'Enter' && event.keyCode !== 13) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Enter' || event.keyCode === 13) { if (!event.repeat) target.click(); return }
    if (action === 'info') { activate(true); return }
    if (action === 'up' || action === 'down' || action.startsWith('channel-')) {
      const delta = action === 'up' ? -1 : action === 'down' ? 1 : action === 'channel-up' ? -count : count
      if (!selected && action === 'up') { focus(btn('category')); return }
      selected = Math.max(0, Math.min(channels.length - 1, selected + delta))
      if (selected < first || selected >= first + count) render(true); else focusSelection()
    } else if (channelColumn) {
      if (action === 'left') options.sidebar(); else { channelColumn = false; focusSelection() }
    } else {
      followsNow = false
      const row = selectedRow(), next = cellIndex(row) + (action === 'left' ? -1 : 1)
      if (row && next >= 0 && next < row.cells.length) { anchor = row.cells[next].start; focusSelection() }
      else shift(action === 'left' ? -span : span)
    }
  })
  function suspend() { active = false; cancelGuide(); channelLoad?.abort(); categoryLoad?.abort(); categoryPicker.suspend(); clearInterval(timer); timer = undefined }
  function resume(takeFocus = true) {
    active = true; el('options').hidden = el('categories').hidden = true; translate(); measure()
    if (followsNow && Date.now() >= from + span || anchor < Date.now() - 7 * DAY || anchor > Date.now() + 2 * DAY) { anchor = Date.now(); from = Math.floor(anchor / HALF_HOUR) * HALF_HOUR }
    render(takeFocus); clearInterval(timer); timer = setInterval(() => {
      if (!active) return
      if (followsNow && Date.now() >= from + span && el('options').hidden && el('categories').hidden) { anchor = Date.now(); from = Math.floor(anchor / HALF_HOUR) * HALF_HOUR; render(el('rows').contains(document.activeElement)) }
      else { summary(); heading() }
    }, 60000)
    if (!channels.length || loadingChannels) void loadChannels(takeFocus)
  }
  return {
    open(key: string) { if (key !== source) { suspend(); source = key; channels = []; category = undefined; selected = first = 0; channelColumn = false; followsNow = true; anchor = Date.now(); from = Math.floor(anchor / HALF_HOUR) * HALF_HOUR }; resume() },
    reset() { suspend(); source = ''; channels = []; rows = []; categoryPicker.clear() },
    resume, suspend,
    refreshChannels() { if (active && !category && !channelLoad) void loadChannels(false) },
    focus: focusSelection,
  }
}

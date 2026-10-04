import type { Channel } from './catalog'
import type { Category, MediaKind } from './xtream'
import { homeKind } from './source-home'
import { keyAction } from './remote'
import { tr } from './i18n'

export const CATEGORY_PAGE_SIZE = 16
export type CategoryPosition = { query: string; page: number }
export type CategoryPage = { items: Category[]; total: number; page: number; pages: number }
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const check = (signal: AbortSignal) => { if (signal.aborted) throw new Error('Category search cancelled.') }

/** Only retain category names, never duplicate the full title arrays. */
export async function playlistCategories(channels: Channel[], signal: AbortSignal, kind?: MediaKind): Promise<Category[]> {
  const names = new Set<string>(); let started = performance.now()
  check(signal)
  for (let index = 0; index < channels.length; index++) {
    const channel = channels[index]
    if (!kind || homeKind(channel) === kind) names.add(channel.group)
    if (index % 512 === 0 && performance.now() - started >= 10) { await pause(); check(signal); started = performance.now() }
  }
  // Build the compact directory cooperatively too: a playlist may have a unique
  // category on every title. Neither pass creates an option/button per name.
  const entries: Category[] = []; let index = 0
  for (const name of names) {
    entries.push({ id: name, name })
    if (++index % 512 === 0 && performance.now() - started >= 10) { await pause(); check(signal); started = performance.now() }
  }
  check(signal); return entries
}

/** Count all matches, retaining just one page, and yield during large scans. */
export async function categoryPage(entries: readonly Category[], query: string, requested: number, signal: AbortSignal, anchor?: string): Promise<CategoryPage> {
  const needle = query.trim().toLocaleLowerCase()
  let page = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0
  check(signal)
  if (!needle && anchor === undefined) {
    const pages = Math.ceil(entries.length / CATEGORY_PAGE_SIZE)
    page = Math.min(page, Math.max(0, pages - 1))
    return { items: entries.slice(page * CATEGORY_PAGE_SIZE, (page + 1) * CATEGORY_PAGE_SIZE), total: entries.length, page, pages }
  }
  let items: Category[] = [], total = 0, anchored = -1, started = performance.now()
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!needle || entry.name.toLocaleLowerCase().includes(needle)) {
      if (entry.id === anchor) anchored = Math.floor(total / CATEGORY_PAGE_SIZE)
      if (total >= page * CATEGORY_PAGE_SIZE && items.length < CATEGORY_PAGE_SIZE) items.push(entry)
      total++
    }
    if (index % 512 === 0 && performance.now() - started >= 10) { await pause(); check(signal); started = performance.now() }
  }
  check(signal)
  const pages = Math.ceil(total / CATEGORY_PAGE_SIZE), resolved = anchored >= 0 ? anchored : Math.min(page, Math.max(0, pages - 1))
  if (resolved !== page) return categoryPage(entries, query, resolved, signal)
  return { items, total, page, pages }
}

/** Shared bounded list for the category sidebar and the large group picker. */
export function categoryBrowser(root: HTMLElement, list: HTMLElement, prefix: string, selected: () => string | undefined) {
  const tools = document.createElement('div'), search = document.createElement('input'), label = document.createElement('label'), status = document.createElement('p')
  const paging = document.createElement('div'), previous = document.createElement('button'), next = document.createElement('button'), pageLabel = document.createElement('span')
  tools.className = 'category-tools'; paging.className = 'category-paging'; status.className = 'hint'; status.setAttribute('role', 'status')
  search.id = `${prefix}-search`; search.type = 'search'; search.maxLength = 200; search.autocomplete = 'off'; search.placeholder = tr('Find a category')
  label.htmlFor = search.id; label.textContent = tr('Find a category')
  previous.id = `${prefix}-previous`; next.id = `${prefix}-next`; previous.type = next.type = 'button'
  previous.textContent = '←'; next.textContent = '→'; previous.setAttribute('aria-label', tr('Previous category page')); next.setAttribute('aria-label', tr('Next category page'))
  status.id = `${prefix}-status`; pageLabel.id = `${prefix}-page`; pageLabel.className = 'hint'
  paging.append(previous, pageLabel, next); tools.append(label, search, status); root.insertBefore(tools, list); list.after(paging)
  let entries: readonly Category[] = [], choose: (entry: Category) => void = () => {}, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let page = 0, pages = 0, revision = 0, suspended = false
  const cancel = () => { revision++; controller?.abort(); controller = undefined; clearTimeout(timer); timer = undefined }
  const mark = () => { for (const button of list.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.category === selected())) }
  async function find(focus = false, anchor?: string) {
    cancel(); const token = revision, request = new AbortController(); controller = request
    const ownedFocus = list.contains(document.activeElement), focusedId = ownedFocus ? (document.activeElement as HTMLElement).dataset.category : undefined
    previous.disabled = next.disabled = true; list.setAttribute('aria-busy', 'true'); status.textContent = tr('Searching categories…')
    try {
      const result = await categoryPage(entries, search.value, page, request.signal, anchor)
      if (revision !== token || suspended) return
      page = result.page; pages = result.pages
      const fragment = document.createDocumentFragment()
      for (const entry of result.items) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = entry.name; button.dataset.category = entry.id
        button.onclick = () => { if (revision === token && !suspended) choose(entry) }; fragment.append(button)
      }
      list.replaceChildren(fragment); mark()
      status.textContent = result.total ? tr(result.total === 1 ? '{count} category' : '{count} categories', { count: result.total.toLocaleString() }) : tr('No matching categories')
      pageLabel.textContent = pages ? tr('{page} / {pages}', { page: page + 1, pages }) : '0 / 0'
      previous.disabled = page === 0; next.disabled = page + 1 >= pages
      tools.hidden = entries.length <= CATEGORY_PAGE_SIZE && !search.value; paging.hidden = pages <= 1
      if (focus || ownedFocus) {
        const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')]
        const target = !focus && buttons.find(button => button.dataset.category === focusedId)
        const element = target || buttons[0] || search
        element.focus({ preventScroll: true }); if (focus) element.scrollIntoView?.({ block: 'nearest' })
      }
    } catch { /* Navigation/search cancellation retains the current source. */ }
    finally { if (revision === token) { controller = undefined; list.setAttribute('aria-busy', 'false') } }
  }
  const turn = (delta: number) => { if (suspended || controller || page + delta < 0 || page + delta >= pages) return; page += delta; void find(true) }
  search.oninput = () => { cancel(); page = pages = 0; list.replaceChildren(); previous.disabled = next.disabled = true; status.textContent = tr('Searching categories…'); timer = setTimeout(() => { void find() }, 180) }
  search.onkeydown = event => { if (!event.isComposing && (event.key === 'Enter' || event.keyCode === 13)) { event.preventDefault(); void find(true) } }
  previous.onclick = () => turn(-1); next.onclick = () => turn(1)
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || suspended || root.closest('[hidden]')) return
    const action = keyAction(event.key, event.keyCode)
    if (action === 'channel-up' || action === 'channel-down') { event.preventDefault(); event.stopPropagation(); turn(action === 'channel-up' ? -1 : 1) }
  }
  root.addEventListener('keydown', keydown)
  return {
    set(values: readonly Category[], onChoose: (entry: Category) => void, position?: CategoryPosition, anchor?: string) {
      cancel(); suspended = false; entries = values; choose = onChoose; page = position?.page || 0; pages = 0; search.value = position?.query || ''
      list.hidden = false; tools.hidden = paging.hidden = values.length <= CATEGORY_PAGE_SIZE && !search.value
      return find(false, anchor)
    },
    get position(): CategoryPosition { return { query: search.value, page } },
    mark,
    suspend() { cancel(); suspended = true; list.setAttribute('aria-busy', 'false') },
    resume() { if (suspended) { suspended = false; void find() } },
    clear() { cancel(); suspended = false; entries = []; choose = () => {}; page = pages = 0; search.value = ''; list.replaceChildren(); tools.hidden = paging.hidden = true },
    dispose() { this.clear(); root.removeEventListener('keydown', keydown); tools.remove(); paging.remove() },
  }
}

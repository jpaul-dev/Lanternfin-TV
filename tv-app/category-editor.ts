import { categoryBrowser } from './category-browser'
import { cloneCategoryRules, MAX_CATEGORY_RULES, type CategoryRules } from './category-rules'
import { keyAction } from './remote'
import { tr } from './i18n'
import type { Category, MediaKind } from './xtream'

/** Bounded multi-selection with draft/save, and explicit remote lanes. */
export function categoryEditor(root: HTMLElement, options: {
  load: (kind: MediaKind, signal: AbortSignal) => Promise<Category[]>
  save: (rules: CategoryRules) => void
  close: () => void
}) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#visibility-${id}`)!
  const list = el('list'), tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-kind]')], modes = [...root.querySelectorAll<HTMLButtonElement>('[data-mode]')]
  let draft: CategoryRules = {}, kind: MediaKind = 'live', marked = new Set<string>(), active = false
  let controller: AbortController | undefined, entries: Category[] = []
  let release: string | undefined
  const key = (event: KeyboardEvent) => String(event.keyCode || event.key)
  const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
  const held = (event: KeyboardEvent) => { if (release === key(event) && event.repeat) swallow(event) }
  const keyup = (event: KeyboardEvent) => { if (release === key(event)) { swallow(event); release = undefined } }
  document.addEventListener('keydown', held, true); document.addEventListener('keyup', keyup, true)
  const browser = categoryBrowser(el('directory'), list, 'visibility', () => undefined, id => marked.has(id))
  const focus = (node?: HTMLElement) => { node?.focus({ preventScroll: true }); node?.scrollIntoView?.({ block: 'nearest' }) }
  const stop = () => { controller?.abort(); controller = undefined; browser.suspend() }
  function sync() {
    const mode = draft[kind]?.mode || 'hide'
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.kind === kind))
    for (const button of modes) button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
    el('instruction').textContent = tr(mode === 'hide' ? 'Check the categories you want to hide.' : 'Check the categories you want to see. An empty selection shows all categories.')
    el('selection').textContent = tr(mode === 'hide' ? marked.size === 1 ? '{count} category hidden' : '{count} categories hidden' : marked.size === 1 ? '{count} category selected' : '{count} categories selected', { count: marked.size.toLocaleString() })
    el('reset').textContent = tr('Show all in this section')
    browser.mark()
  }
  const changed = () => { el('note').textContent = tr('Changes apply when you save. Favorites and viewing progress are kept.'); sync() }
  const choose = (entry: Category) => {
    if (!active || controller) return
    const total = Object.values(draft).reduce((count, rule) => count + (rule?.ids.length || 0), 0)
    if (!marked.has(entry.id) && total >= MAX_CATEGORY_RULES) { el('note').textContent = tr('Choose up to 10,000 categories across Live TV, Movies and Series.'); return }
    marked.has(entry.id) ? marked.delete(entry.id) : marked.add(entry.id)
    draft[kind] = { mode: draft[kind]?.mode || 'hide', ids: [...marked] }; changed()
  }
  async function load(next: MediaKind) {
    stop(); kind = next; marked = new Set(draft[kind]?.ids || []); entries = []; browser.clear(); browser.suspend(); sync()
    const request = new AbortController(); controller = request
    el('loading').textContent = tr('Loading categories…'); el('retry').hidden = true
    try {
      entries = await options.load(kind, request.signal)
      if (controller !== request || request.signal.aborted || !active) return
      controller = undefined; el('loading').textContent = entries.length ? '' : tr('No categories loaded in this section.')
      const names = new Map<string, number>()
      for (const entry of entries) names.set(entry.name, (names.get(entry.name) || 0) + 1)
      await browser.set(entries.map(entry => names.get(entry.name)! > 1 ? { ...entry, name: `${entry.name} · ${entry.id}` } : entry), choose)
    } catch {
      if (controller === request && !request.signal.aborted && active) { el('loading').textContent = tr('Categories could not be loaded. Try again.'); el('retry').hidden = false }
    } finally { if (controller === request) controller = undefined }
  }
  for (const tab of tabs) tab.onclick = () => { if (active) void load(tab.dataset.kind as MediaKind) }
  for (const button of modes) button.onclick = () => {
    if (!active) return
    draft[kind] = { mode: button.dataset.mode as 'hide' | 'select', ids: [...marked] }; changed()
  }
  el('reset').onclick = () => { if (!active) return; marked.clear(); draft[kind] = { mode: 'hide', ids: [] }; changed() }
  el('retry').onclick = () => { if (active) void load(kind) }
  el('save').onclick = () => {
    if (!active) return
    try { options.save(cloneCategoryRules(draft)); stop(); options.close() }
    catch (error) { el('note').textContent = tr((error as Error).message || 'Your changes could not be saved. Try again.'); focus(el('save')) }
  }
  el('cancel').onclick = () => { if (active) { stop(); options.close() } }
  root.addEventListener('keydown', event => {
    if (!active || event.isComposing) return
    const target = event.target as HTMLElement, action = keyAction(event.key, event.keyCode)
    if (action === 'channel-up' || action === 'channel-down') return // Directory owns page keys.
    if (target instanceof HTMLInputElement && ['left', 'right'].includes(action)) { event.stopPropagation(); return }
    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault(); event.stopPropagation()
      release = key(event)
      // Search owns its OK. Never activate the result focused by the search.
      if (!event.repeat && target instanceof HTMLButtonElement) target.click()
      return
    }
    if (action === 'back') { event.preventDefault(); event.stopPropagation(); release = key(event); if (!event.repeat) el('cancel').click(); return }
    if (!['left', 'right', 'up', 'down'].includes(action)) return
    event.preventDefault(); event.stopPropagation()
    const visible = (nodes: HTMLElement[]) => nodes.filter(node => !node.closest('[hidden]') && !(node instanceof HTMLButtonElement && node.disabled))
    const paging = visible([el('previous'), el('next')]), actions = [el('save'), el('cancel')]
    const side = visible([...modes, el('reset'), el('retry')]), main = visible([el('search'), ...list.querySelectorAll<HTMLElement>('button')])
    const rtl = document.documentElement.dir === 'rtl', toMain = rtl ? 'left' : 'right', toSide = rtl ? 'right' : 'left'
    if (tabs.includes(target as HTMLButtonElement) && action === 'down') { focus(modes.find(button => button.getAttribute('aria-pressed') === 'true')); return }
    if (side.includes(target)) {
      if (action === toMain) focus(main[0] || actions[0])
      else if (action === 'up') focus(side[side.indexOf(target) - 1] || tabs.find(tab => tab.dataset.kind === kind))
      else if (action === 'down') focus(side[side.indexOf(target) + 1] || actions[0])
      return
    }
    if ((main.includes(target) || paging.includes(target)) && action === toSide) { focus(modes.find(button => button.getAttribute('aria-pressed') === 'true')); return }
    const rows: HTMLElement[][] = [tabs, [el('search')], ...[...list.querySelectorAll<HTMLElement>('button')].map(button => [button]), paging, actions].map(visible).filter(row => row.length)
    const row = rows.findIndex(items => items.includes(target)); if (row < 0) return
    if (action === 'up' || action === 'down') {
      const next = rows[Math.max(0, Math.min(rows.length - 1, row + (action === 'up' ? -1 : 1)))]
      focus(next.find(node => node.getAttribute('aria-pressed') === 'true') || next[0])
    } else {
      const cells = rows[row], delta = (action === 'left' ? -1 : 1) * (document.documentElement.dir === 'rtl' ? -1 : 1)
      focus(cells[Math.max(0, Math.min(cells.length - 1, cells.indexOf(target) + delta))])
    }
  })
  return {
    open(value: CategoryRules) { draft = cloneCategoryRules(value); active = true; el('note').textContent = ''; void load('live') },
    close() { active = false; stop(); entries = []; browser.clear(); browser.suspend() },
    dispose() { this.close(); browser.dispose(); document.removeEventListener('keydown', held, true); document.removeEventListener('keyup', keyup, true) },
  }
}

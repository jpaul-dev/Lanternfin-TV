import { tr } from './i18n'
import { HOME_ROWS, DEFAULT_HOME_ROWS, normalizeHomeRows, type HomeRow } from './home-config'
import { categoryIdentity, cloneSourceHome, MAX_CATEGORY_ROWS, type CategoryChoices, type HomeCategory, type HomeRowId, type SourceHome } from './source-home'
import type { MediaKind } from './xtream'
export { HOME_ROWS, DEFAULT_HOME_ROWS, normalizeHomeRows, type HomeRow } from './home-config'

type FindCategories = (kind: MediaKind, query: string, signal: AbortSignal) => Promise<CategoryChoices>
const kinds = { live: 'Live TV', movie: 'Movies', series: 'Series' }
/** All row and category edits stay in a draft until the single source-library write. */
export function homeLayoutUI(root: HTMLElement, save: (layout: SourceHome) => void, close: () => void, find?: FindCategories) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#layout-${id}`)!
  let order: HomeRowId[] = [...DEFAULT_HOME_ROWS], visible = new Set<HomeRowId>(DEFAULT_HOME_ROWS), categories: HomeCategory[] = []
  let choices: CategoryChoices['choices'] = [], controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => { controller?.abort(); controller = undefined; clearTimeout(timer) }
  const status = (text: string) => { el('status').textContent = tr(text) }
  const labelFor = (id: HomeRowId) => { const category = categories.find(row => row.id === id); return category ? `${category.title} · ${tr(kinds[category.kind])}` : tr(HOME_ROWS[id as HomeRow]) }
  const changed = () => status('Changes apply when you save.')
  const render = (focus?: { row: HomeRowId; action: string }) => {
    const list = el('rows'); list.replaceChildren()
    for (const [index, id] of order.entries()) {
      const row = document.createElement('div'); row.className = 'home-layout-row'; row.dataset.row = id
      const label = document.createElement('label'), checkbox = document.createElement('input'), name = document.createElement('span')
      checkbox.type = 'checkbox'; checkbox.checked = visible.has(id); checkbox.dataset.action = 'visible'
      name.textContent = labelFor(id); label.append(checkbox, name)
      checkbox.onchange = () => { checkbox.checked ? visible.add(id) : visible.delete(id); changed() }
      const actions = document.createElement('div'); actions.className = 'actions'
      for (const [action, delta, text] of [['up', -1, 'Move up'], ['down', 1, 'Move down']] as const) {
        const button = document.createElement('button'); button.dataset.action = action; button.textContent = tr(text)
        button.setAttribute('aria-label', tr(action === 'up' ? 'Move {name} up' : 'Move {name} down', { name: labelFor(id) }))
        button.disabled = index + delta < 0 || index + delta >= order.length
        button.onclick = () => {
          const next = index + delta; [order[index], order[next]] = [order[next], order[index]]
          render({ row: id, action: next === 0 && action === 'up' || next === order.length - 1 && action === 'down' ? 'visible' : action }); changed()
        }
        actions.append(button)
      }
      if (categories.some(category => category.id === id)) {
        const remove = document.createElement('button'); remove.textContent = tr('Remove'); remove.dataset.action = 'remove'
        remove.setAttribute('aria-label', tr('Remove {name} row', { name: labelFor(id) }))
        remove.onclick = () => { categories = categories.filter(category => category.id !== id); order = order.filter(entry => entry !== id); visible.delete(id); render(order.length ? { row: order[Math.min(index, order.length - 1)], action: 'visible' } : undefined); if (!order.length) el('save').focus(); changed() }
        actions.append(remove)
      }
      row.append(label, actions); list.append(row)
    }
    el('category-count').textContent = tr('{count} of 8 category rows', { count: categories.length })
    el<HTMLButtonElement>('add').disabled = categories.length >= MAX_CATEGORY_ROWS || !choices.length
    if (focus) list.querySelector<HTMLElement>(`[data-row="${focus.row}"] [data-action="${focus.action}"]`)?.focus()
  }
  const search = async () => {
    stop(); if (!find) return
    const request = new AbortController(); controller = request; choices = []
    const select = el<HTMLSelectElement>('category'); select.replaceChildren(); select.disabled = true; el<HTMLButtonElement>('add').disabled = true
    el('category-note').textContent = tr('Loading categories…')
    try {
      const result = await find(el<HTMLSelectElement>('kind').value as MediaKind, el<HTMLInputElement>('search').value, request.signal)
      if (controller !== request || request.signal.aborted) return
      choices = result.choices
      const names = new Map<string, number>(); for (const choice of choices) names.set(choice.title, (names.get(choice.title) || 0) + 1)
      for (const [index, choice] of choices.entries()) select.add(new Option(choice.title + ((names.get(choice.title) || 0) > 1 && choice.categoryId ? ` · ${choice.categoryId}` : ''), String(index)))
      select.disabled = !choices.length; el<HTMLButtonElement>('add').disabled = !choices.length || categories.length >= MAX_CATEGORY_ROWS
      el('category-note').textContent = tr(result.more ? 'Showing the first 100 matches. Search to narrow the list.' : choices.length ? 'Categories from this source. Refresh the choices as more of your library loads.' : 'No matching categories loaded. Try another search or refresh after your library loads.')
    } catch { if (controller === request && !request.signal.aborted) el('category-note').textContent = tr('Categories could not be loaded. Try again.') }
  }
  el('kind').onchange = () => { void search() }
  el('search').oninput = () => { stop(); choices = []; el<HTMLSelectElement>('category').disabled = true; el<HTMLButtonElement>('add').disabled = true; timer = setTimeout(() => { void search() }, 150) }
  el('refresh').onclick = () => { void search() }
  el('add').onclick = () => {
    const choice = choices[Number(el<HTMLSelectElement>('category').value)]
    if (!choice || categories.length >= MAX_CATEGORY_ROWS) return
    const existing = categories.find(row => categoryIdentity(row) === categoryIdentity(choice))
    if (existing) { status('That category already has a row. Enable it in the list above.'); el('rows').querySelector<HTMLElement>(`[data-row="${existing.id}"] input`)?.focus(); return }
    const id = Array.from({ length: MAX_CATEGORY_ROWS }, (_, index) => `category-${index}` as const).find(id => !categories.some(row => row.id === id))!
    categories.push({ ...choice, id, title: el<HTMLInputElement>('title').value.trim().slice(0, 200) || choice.title }); order.push(id); visible.add(id)
    el<HTMLInputElement>('title').value = ''; render({ row: id, action: 'visible' }); changed()
  }
  el('reset').onclick = () => { order = [...DEFAULT_HOME_ROWS, ...categories.map(row => row.id)]; visible = new Set(DEFAULT_HOME_ROWS); render(); status('Default rows selected. Save to apply.') }
  el('save').onclick = () => { try { save(cloneSourceHome({ rows: order.filter(id => visible.has(id)), categories })); stop(); close() } catch { status('The TV could not save this layout. Your previous layout is unchanged.') } }
  el('back').onclick = () => { stop(); close() }
  return {
    close: stop,
    open(value: SourceHome | HomeRow[], allowCategories = true) {
      stop(); const selected = Array.isArray(value) ? { rows: normalizeHomeRows(value), categories: [] } : cloneSourceHome(value)
      categories = selected.categories; visible = new Set(selected.rows)
      order = [...selected.rows, ...DEFAULT_HOME_ROWS.filter(id => !visible.has(id)), ...categories.map(row => row.id).filter(id => !visible.has(id))]
      el<HTMLInputElement>('search').value = el<HTMLInputElement>('title').value = ''; el<HTMLSelectElement>('kind').value = 'movie'; choices = []
      el('add-panel').hidden = !find || !allowCategories; status(''); render(); if (find && allowCategories) void search()
    },
  }
}

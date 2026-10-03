import { tr } from './i18n'

export const HOME_ROWS = { continue: 'Continue watching', watchlist: 'Watchlist', recent: 'Recently watched', favorites: 'Your favorites', live: 'Live TV', 'new-movies': 'Recently added movies', 'new-series': 'Recently added series', movies: 'Movies', series: 'Series & episodes' } as const
export type HomeRow = keyof typeof HOME_ROWS
export const DEFAULT_HOME_ROWS = Object.keys(HOME_ROWS) as HomeRow[]
export function normalizeHomeRows(value: unknown): HomeRow[] {
  if (!Array.isArray(value) || value.length > DEFAULT_HOME_ROWS.length || value.some(id => typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(HOME_ROWS, id)) || new Set(value).size !== value.length) return [...DEFAULT_HOME_ROWS]
  return [...value] as HomeRow[]
}

/** Edit a local draft. Only Save applies the visible row order. */
export function homeLayoutUI(root: HTMLElement, save: (rows: HomeRow[]) => void, close: () => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#layout-${id}`)!
  let order = [...DEFAULT_HOME_ROWS], visible = new Set(DEFAULT_HOME_ROWS)
  const render = (focus?: { row: HomeRow; action: string }) => {
    const list = el('rows'); list.replaceChildren()
    for (const [index, id] of order.entries()) {
      const row = document.createElement('div'); row.className = 'home-layout-row'; row.dataset.row = id
      const label = document.createElement('label'), checkbox = document.createElement('input'), name = document.createElement('span')
      checkbox.type = 'checkbox'; checkbox.checked = visible.has(id); checkbox.dataset.action = 'visible'
      name.textContent = tr(HOME_ROWS[id]); label.append(checkbox, name)
      checkbox.onchange = () => { checkbox.checked ? visible.add(id) : visible.delete(id); el('status').textContent = tr('Changes apply when you save.') }
      const actions = document.createElement('div'); actions.className = 'actions'
      for (const [action, delta, text] of [['up', -1, 'Move up'], ['down', 1, 'Move down']] as const) {
        const button = document.createElement('button'); button.dataset.action = action; button.textContent = tr(text)
        button.setAttribute('aria-label', tr(action === 'up' ? 'Move {name} up' : 'Move {name} down', { name: tr(HOME_ROWS[id]) }))
        button.disabled = index + delta < 0 || index + delta >= order.length
        button.onclick = () => {
          const next = index + delta; [order[index], order[next]] = [order[next], order[index]]
          render({ row: id, action: next === 0 && action === 'up' || next === order.length - 1 && action === 'down' ? 'visible' : action })
          el('status').textContent = tr('Changes apply when you save.')
        }
        actions.append(button)
      }
      row.append(label, actions); list.append(row)
    }
    if (focus) list.querySelector<HTMLElement>(`[data-row="${focus.row}"] [data-action="${focus.action}"]`)?.focus()
  }
  el('reset').onclick = () => { order = [...DEFAULT_HOME_ROWS]; visible = new Set(order); render(); el('status').textContent = tr('Default rows selected. Save to apply.') }
  el('save').onclick = () => { try { save(order.filter(id => visible.has(id))); close() } catch { el('status').textContent = tr('The TV could not save this layout. Your previous layout is unchanged.') } }
  el('back').onclick = close
  return { open(rows: HomeRow[]) { const selected = normalizeHomeRows(rows); visible = new Set(selected); order = [...selected, ...DEFAULT_HOME_ROWS.filter(id => !visible.has(id))]; el('status').textContent = ''; render() } }
}

import type { Channel } from './catalog'
import type { Category } from './xtream'
import { categoryBrowser, playlistCategories } from './category-browser'
import { keyAction, moveFocus, type Direction } from './remote'
import { tr } from './i18n'

/** Small lists keep their select; large directories never create thousands of options. */
export function groupPicker(select: HTMLSelectElement) {
  const open = document.createElement('button'), dialog = document.createElement('dialog'), title = document.createElement('h2'), cancel = document.createElement('button'), all = document.createElement('button'), list = document.createElement('div')
  open.id = 'group-open'; open.type = 'button'; open.hidden = true; open.setAttribute('aria-haspopup', 'dialog'); open.setAttribute('aria-expanded', 'false'); select.after(open)
  dialog.id = 'group-picker'; dialog.className = 'group-picker'; dialog.setAttribute('aria-labelledby', 'group-picker-title')
  title.id = 'group-picker-title'; title.textContent = tr('Choose a category'); cancel.textContent = tr('Cancel'); all.textContent = tr('All groups'); cancel.type = all.type = 'button'
  cancel.id = 'group-cancel'; all.id = 'group-all'; list.id = 'group-list'; list.className = 'group-choice-list'
  const heading = document.createElement('div'); heading.className = 'settings-choice-header'; heading.append(title, cancel); dialog.append(heading, all, list); document.body.append(dialog)
  const browser = categoryBrowser(dialog, list, 'group', () => select.value)
  let entries: Category[] = [], loading: AbortController | undefined, revision = 0, release: string | undefined
  const sync = () => { open.textContent = select.value ? select.selectedOptions[0]?.textContent || select.value : tr('All groups'); open.setAttribute('aria-label', tr('Category: {name}', { name: open.textContent })) }
  const key = (event: KeyboardEvent) => String(event.keyCode || event.key)
  const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
  function close(restore = true) {
    browser.suspend(); if (dialog.open) dialog.close(); open.setAttribute('aria-expanded', 'false')
    if (restore && !open.closest('[hidden]')) open.focus()
  }
  function value(id: string, previousLabel?: string) {
    if (id && ![...select.options].some(option => option.value === id)) {
      if (select.hidden) select.replaceChildren(new Option(tr('All groups'), ''))
      select.add(new Option(entries.find(entry => entry.id === id)?.name || previousLabel || id, id))
    }
    select.value = id; sync(); browser.mark()
  }
  const choose = (name: string) => { close(); if (select.value === name) return; value(name); select.dispatchEvent(new Event('change', { bubbles: true })) }
  open.onclick = () => {
    if (dialog.open || open.disabled) return
    title.textContent = tr('Choose a category'); cancel.textContent = tr('Cancel'); all.textContent = tr('All groups')
    try { dialog.showModal() } catch { return }
    open.setAttribute('aria-expanded', 'true'); void browser.set(entries, entry => choose(entry.id), undefined, select.value)
    dialog.querySelector<HTMLInputElement>('#group-search')!.focus()
  }
  cancel.onclick = () => close(); all.onclick = () => choose('')
  select.addEventListener('change', sync)
  const held = (event: KeyboardEvent) => { if (release === key(event) && event.repeat) swallow(event) }
  document.addEventListener('keydown', held, true)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('keydown', event => {
    if (event.isComposing) return
    const action = keyAction(event.key, event.keyCode), active = document.activeElement
    if (action === 'back') { swallow(event); release = key(event); close(); return }
    if (event.key === 'Tab') {
      const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input')].filter(element => !element.closest('[hidden]'))
      const at = buttons.indexOf(active as HTMLElement); swallow(event); buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); return
    }
    if (action === 'channel-up' || action === 'channel-down') return // The paged list handles these first.
    if (['left', 'right', 'up', 'down'].includes(action)) {
      if (active instanceof HTMLInputElement && ['left', 'right'].includes(action)) { event.stopPropagation(); return }
      swallow(event); moveFocus(action as Direction, dialog); return
    }
    if (event.key === 'Enter' || event.keyCode === 13) {
      // A completed search may focus its first result between bubbling
      // listeners. Use the original target so this OK cannot also choose it.
      if (event.target instanceof HTMLInputElement) { swallow(event); release = key(event); return }
      swallow(event); release = key(event); if (!event.repeat && active instanceof HTMLButtonElement) active.click(); return
    }
    if (action) swallow(event)
  })
  const keyup = (event: KeyboardEvent) => { if (release === key(event)) { swallow(event); release = undefined } }
  document.addEventListener('keyup', keyup, true)
  return {
    value, sync, close,
    refresh(channels: Channel[], include?: (channel: Channel) => boolean) { return this.refreshDirectory(signal => playlistCategories(channels, signal, undefined, include)) },
    async refreshDirectory(load: (signal: AbortSignal) => Promise<Category[]>) {
      loading?.abort(); const request = new AbortController(), token = ++revision; loading = request
      try {
        const values = await load(request.signal)
        if (token !== revision) return
        entries = values
        const selected = select.value, label = select.selectedOptions[0]?.textContent || '', focused = document.activeElement === select || document.activeElement === open
        select.replaceChildren(new Option(tr('All groups'), ''))
        const large = values.length > 200
        if (!large) for (const entry of [...values].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) select.add(new Option(entry.name, entry.id))
        select.hidden = large; open.hidden = !large; value(selected, label)
        if (focused) (large ? open : select).focus({ preventScroll: true })
        if (dialog.open) {
          if (!large) { close(false); if (!select.closest('[hidden]')) select.focus() }
          else await browser.set(entries, entry => choose(entry.id), browser.position)
        }
      } catch { /* Source changes abandon their directory. */ }
      finally { if (loading === request) loading = undefined }
    },
    stop() { revision++; loading?.abort(); loading = undefined; close(false) },
    clear() { this.stop(); entries = []; browser.clear(); select.replaceChildren(new Option(tr('All groups'), '')); select.hidden = false; open.hidden = true; sync() },
    dispose() { this.clear(); browser.dispose(); dialog.remove(); open.remove(); select.removeEventListener('change', sync); document.removeEventListener('keydown', held, true); document.removeEventListener('keyup', keyup, true) },
  }
}

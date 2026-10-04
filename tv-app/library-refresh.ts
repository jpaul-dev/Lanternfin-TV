import { keyAction } from './remote'
import { tr } from './i18n'

/** A cancellable refresh keeps the existing library behind a small modal. */
export function libraryRefresh(options: { cancel(): void; retry(): void }) {
  const dialog = document.createElement('dialog'), title = document.createElement('h2'), status = document.createElement('p'), note = document.createElement('p'), actions = document.createElement('div'), retry = document.createElement('button'), cancel = document.createElement('button')
  dialog.id = 'library-refresh'; dialog.className = 'library-refresh'; dialog.tabIndex = -1; dialog.setAttribute('aria-labelledby', 'library-refresh-title')
  title.id = 'library-refresh-title'; status.id = 'library-refresh-status'; status.setAttribute('role', 'status')
  note.className = 'hint'; actions.className = 'actions'; retry.id = 'library-refresh-retry'; cancel.id = 'library-refresh-cancel'; retry.type = cancel.type = 'button'
  actions.append(retry, cancel); dialog.append(title, status, note, actions); document.body.append(dialog)
  let returnFocus: HTMLElement | undefined, applying = false, release: string | undefined
  const key = (event: KeyboardEvent) => String(event.keyCode || event.key)
  const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
  const close = (restore = true) => {
    if (!dialog.open) return
    dialog.close(); applying = false
    if (restore && returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true })
    returnFocus = undefined
  }
  const back = () => { if (!applying) options.cancel() }
  cancel.onclick = back; retry.onclick = () => { if (!applying) options.retry() }
  dialog.addEventListener('cancel', event => { swallow(event); back() })
  document.addEventListener('keydown', event => { if (release === key(event) && event.repeat) swallow(event) }, true)
  document.addEventListener('keyup', event => { if (release === key(event)) { swallow(event); release = undefined } }, true)
  dialog.addEventListener('keydown', event => {
    if (event.isComposing) { event.stopPropagation(); return }
    const action = keyAction(event.key, event.keyCode)
    if (action === 'back') { swallow(event); release = key(event); if (!event.repeat) back(); return }
    if (event.key === 'Enter' || event.keyCode === 13 || event.key === ' ') {
      const active = document.activeElement; swallow(event); release = key(event)
      if (!event.repeat && active instanceof HTMLButtonElement && !active.disabled) active.click()
      return
    }
    if (event.key === 'Tab' || ['left','right','up','down'].includes(action)) {
      swallow(event)
      const items = [retry, cancel].filter(button => !button.hidden && !button.disabled)
      if (!items.length) return
      const forward = event.key === 'Tab' ? !event.shiftKey : action === 'down' ? true : action === 'up' ? false : (action === 'right') !== (document.documentElement.dir === 'rtl')
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(at + (forward ? 1 : -1) + items.length) % items.length].focus()
      return
    }
    if (action) swallow(event)
  })
  return {
    open() {
      if (!dialog.open) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
        try { dialog.showModal() } catch { returnFocus = undefined; return false }
      }
      applying = false; retry.hidden = true; cancel.disabled = false
      title.textContent = tr('Refresh library'); retry.textContent = tr('Retry'); cancel.textContent = tr('Cancel')
      status.textContent = tr('Loading…'); note.textContent = tr('Your current library stays available if loading fails or is cancelled.')
      cancel.focus(); return true
    },
    progress(message: string) { if (dialog.open) status.textContent = message },
    applying() { applying = true; status.textContent = tr('Applying library…'); note.textContent = ''; cancel.disabled = true; dialog.focus() },
    failed(message: string) {
      applying = false; status.textContent = message; note.textContent = tr('Refresh failed. Your current library is unchanged.')
      retry.hidden = false; cancel.disabled = false; cancel.textContent = tr('Back'); retry.focus()
    },
    close,
  }
}

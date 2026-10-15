import { tr } from './i18n'
import { ACCENTS } from './preferences'
import { keyAction } from './remote'

type Choice = { option: HTMLOptionElement; index: number; value: string; text: string; button: HTMLButtonElement }
// Signed offsets and percentages contain no strong LTR character for dir=auto.
export const choiceDirection = (text: string) => /^(?:UTC)?[+−-]?\d+(?:[.:]\d+)*(?:%|×)?$/.test(text) ? 'ltr' : 'auto'
const enabled = (option: HTMLOptionElement) => !option.disabled && !option.closest('[hidden]') && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)

/** Keep the existing select/change contract, with an app-rendered TV choice list. */
export function settingsChoices(root: HTMLElement) {
  const dialog = document.createElement('dialog'), title = document.createElement('h2'), list = document.createElement('div')
  const header = document.createElement('div'), cancel = document.createElement('button'), hint = document.createElement('p')
  dialog.id = 'settings-choice'; dialog.className = 'settings-choice'; dialog.setAttribute('aria-labelledby', 'settings-choice-title')
  title.id = 'settings-choice-title'; header.className = 'settings-choice-header'
  cancel.type = 'button'; cancel.className = 'subtle'; list.className = 'settings-choice-list'
  list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-labelledby', title.id)
  hint.className = 'settings-choice-hint'
  header.append(title, cancel); dialog.append(header, list, hint); document.body.append(dialog)
  let control: HTMLSelectElement | undefined, originalIndex = -1, choices: Choice[] = [], release: string | undefined
  const key = (event: KeyboardEvent) => event.keyCode ? String(event.keyCode) : event.key
  const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
  const focus = (button: HTMLButtonElement) => { button.focus(); button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }
  const observer = new MutationObserver(() => { if (control) close() })
  function close(restoreFocus = true) {
    observer.disconnect()
    const previous = control; control = undefined; choices = []
    if (dialog.open) dialog.close()
    list.replaceChildren()
    previous?.setAttribute('aria-expanded', 'false')
    if (restoreFocus && previous?.isConnected && !previous.disabled && !previous.closest('[hidden]')) previous.focus()
  }
  function choose(entry: Choice) {
    const target = control
    // Do not commit a stale option after a source/language/availability update.
    const valid = target?.isConnected && !target.disabled && !target.closest('[hidden]') && target.selectedIndex === originalIndex && target.options[entry.index] === entry.option && entry.option.value === entry.value && entry.option.text === entry.text && enabled(entry.option)
    close()
    if (!target || !valid || target.selectedIndex === entry.index) return
    target.selectedIndex = entry.index
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function open(target: HTMLSelectElement): boolean {
    if (control || target.disabled || target.multiple || target.closest('[hidden]') || !target.options.length || target.options.length > 200 || typeof dialog.showModal !== 'function') return false
    const label = target.labels?.[0], caption = (label?.querySelector('span') || label)?.cloneNode(true) as HTMLElement | undefined
    caption?.querySelectorAll('select,small').forEach(node => node.remove())
    title.textContent = caption?.textContent?.trim() || target.getAttribute('aria-label') || tr('Settings')
    cancel.textContent = tr('Cancel'); hint.textContent = tr('Up / down to browse · OK to choose · Back to cancel')
    originalIndex = target.selectedIndex
    choices = [...target.options].map((option, index) => {
      const button = document.createElement('button'), text = document.createElement('span'), mark = document.createElement('span')
      button.type = 'button'; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', String(index === originalIndex)); button.disabled = !enabled(option)
      button.hidden = !!option.closest('[hidden]'); text.textContent = option.text; text.dir = choiceDirection(option.text); mark.className = 'settings-choice-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = index === originalIndex ? '✓' : ''
      if (['pref-accent', 'source-accent'].includes(target.id) && Object.prototype.hasOwnProperty.call(ACCENTS, option.value)) {
        const swatch = document.createElement('span'); swatch.className = 'settings-choice-swatch'; swatch.setAttribute('aria-hidden', 'true')
        swatch.style.backgroundColor = ACCENTS[option.value as keyof typeof ACCENTS][document.documentElement.dataset.theme === 'light' ? 1 : 0]; button.append(swatch)
      }
      button.append(text, mark); list.append(button)
      const entry = { option, index, value: option.value, text: option.text, button }; button.onclick = () => choose(entry); return entry
    })
    try { dialog.showModal() } catch { choices = []; list.replaceChildren(); return false }
    control = target; target.setAttribute('aria-expanded', 'true')
    observer.observe(target, { childList: true, characterData: true, attributes: true, subtree: true, attributeFilter: ['disabled', 'hidden', 'label', 'value', 'selected'] })
    focus(choices.find(entry => entry.index === originalIndex && !entry.button.disabled && !entry.button.hidden)?.button || choices.find(entry => !entry.button.disabled && !entry.button.hidden)?.button || cancel)
    return true
  }
  const selectAt = (event: Event) => event.target instanceof HTMLSelectElement && root.contains(event.target) ? event.target : undefined
  const pointerDown = (event: Event) => {
    const target = selectAt(event)
    // Prevent the browser's popup on pointer-down; open ours on click to avoid click-through.
    if (target && !target.disabled && !target.multiple && target.options.length > 0 && target.options.length <= 200 && typeof dialog.showModal === 'function') event.preventDefault()
  }
  const click = (event: Event) => { const target = selectAt(event); if (target && open(target)) swallow(event) }
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const activate = event.key === 'Enter' || event.keyCode === 13 || event.key === ' ' || event.keyCode === 32
    if (control) {
      const action = keyAction(event.key, event.keyCode)
      if (action === 'back') { swallow(event); release = key(event); close(); return }
      if (activate) { swallow(event); release = key(event); if (!event.repeat && document.activeElement instanceof HTMLButtonElement && dialog.contains(document.activeElement)) document.activeElement.click(); return }
      const buttons = choices.filter(entry => !entry.button.disabled && !entry.button.hidden).map(entry => entry.button), active = document.activeElement
      if (event.key === 'Tab') {
        const items = [cancel, ...buttons], at = items.indexOf(active as HTMLButtonElement)
        swallow(event); focus(items[(at + (event.shiftKey ? -1 : 1) + items.length) % items.length]); return
      }
      if (['up', 'down', 'channel-up', 'channel-down'].includes(action) || ['Home', 'End'].includes(event.key)) {
        swallow(event)
        if (!buttons.length) { focus(cancel); return }
        const at = buttons.indexOf(active as HTMLButtonElement), step = action.startsWith('channel-') ? 8 : 1
        if (action === 'up' && at <= 0) { focus(cancel); return }
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : at + (action.endsWith('up') ? -step : step)
        focus(buttons[Math.max(0, Math.min(buttons.length - 1, next))]); return
      }
      // Modal keys must not reach screen navigation or playback handlers behind it.
      if (action) swallow(event)
      return
    }
    const target = selectAt(event)
    if (target && (activate || event.altKey && event.key === 'ArrowDown')) {
      if (event.repeat && release === key(event)) { swallow(event); return }
      if (open(target)) { swallow(event); release = key(event) }
    }
  }
  const keyup = (event: KeyboardEvent) => { if (release === key(event)) { swallow(event); release = undefined } }
  cancel.onclick = () => close()
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  dialog.addEventListener('close', () => { if (control && !dialog.open) close() })
  root.addEventListener('pointerdown', pointerDown, true); root.addEventListener('mousedown', pointerDown, true); root.addEventListener('click', click, true)
  document.addEventListener('keydown', keydown, true); document.addEventListener('keyup', keyup, true)
  return {
    close,
    dispose() {
      close(false); dialog.remove()
      root.removeEventListener('pointerdown', pointerDown, true); root.removeEventListener('mousedown', pointerDown, true); root.removeEventListener('click', click, true)
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true)
    },
  }
}

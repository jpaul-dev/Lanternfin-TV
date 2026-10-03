// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsChoices } from '../tv-app/settings-choices'
import { setInterfaceLanguage } from '../tv-app/i18n'

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
let ui: ReturnType<typeof settingsChoices>, picker: HTMLSelectElement
const dialog = () => document.getElementById('settings-choice') as HTMLDialogElement
const down = (key: string, keyCode = 0, repeat = false, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key, keyCode, repeat, shiftKey, bubbles: true, cancelable: true })
  document.activeElement!.dispatchEvent(event); return event
}
const press = (key: string, keyCode = 0, shiftKey = false) => { const event = down(key, keyCode, false, shiftKey); document.activeElement!.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode, bubbles: true, cancelable: true })); return event }
const open = () => { picker.focus(); press('Enter') }
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) } })
  document.body.innerHTML = '<section id="settings"><label for="pref-accent"><span>Accent color<small>More detail</small></span><select id="pref-accent"><option value="fuchsia">Fuchsia</option><option selected value="blue">Blue</option><option disabled value="gold">Gold</option><option value="white">White</option></select></label></section>'
  picker = document.querySelector('select')!; ui = settingsChoices(document.getElementById('settings')!)
})
afterEach(async () => {
  ui.dispose(); vi.restoreAllMocks()
  for (const [name, original] of [['showModal', showModal], ['close', close]] as const) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original)
    else delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[name]
  }
  await setInterfaceLanguage('en', async () => ({})); document.body.innerHTML = ''
})

it('highlights without saving, cancels back to the control, and commits one change only after OK', () => {
  const changed = vi.fn(), input = vi.fn(); picker.onchange = changed; picker.oninput = input
  open(); expect(dialog().open).toBe(true); expect(document.activeElement?.textContent).toBe('Blue✓')
  expect(dialog().querySelector('h2')?.textContent).toBe('Accent color')
  press('ArrowDown'); expect(document.activeElement?.textContent).toBe('White'); expect(picker.value).toBe('blue')
  press('Escape'); expect(dialog().open).toBe(false); expect(document.activeElement).toBe(picker); expect(changed).not.toHaveBeenCalled()
  open(); press('ArrowDown'); down('Enter'); expect(picker.value).toBe('white'); expect(dialog().open).toBe(false)
  expect(changed).toHaveBeenCalledOnce(); expect(input).toHaveBeenCalledOnce()
  down('Enter', 0, true); expect(dialog().open).toBe(false)
  picker.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); open(); press('Enter')
  expect(changed).toHaveBeenCalledOnce(); expect(picker.getAttribute('aria-expanded')).toBe('false')
})

it('opens on pointer click without a native popup and renders labels and swatches as inert UI', () => {
  picker.options[0].text = '<img src=x onerror=bad()> & label'
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); picker.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true); expect(dialog().open).toBe(false)
  picker.click(); expect(dialog().open).toBe(true)
  expect(dialog().querySelector('img')).toBeNull(); expect(dialog().textContent).toContain('<img src=x onerror=bad()> & label')
  expect(dialog().querySelectorAll('.settings-choice-swatch')).toHaveLength(4)
  expect(dialog().querySelector('[aria-checked=true]')?.textContent).toBe('Blue✓')
  ;(dialog().querySelector('.settings-choice-header button') as HTMLButtonElement).click()
  expect(dialog().open).toBe(false); expect(picker.value).toBe('blue')
})

it('pages long lists, skips unavailable choices, traps Tab, and keeps Cancel reachable with arrows', () => {
  picker.replaceChildren(...Array.from({ length: 54 }, (_, i) => new Option(`Choice ${i}`, String(i))))
  picker.options[1].disabled = true; picker.options[2].hidden = true; picker.selectedIndex = 30
  open(); press('PageDown'); expect(document.activeElement?.textContent).toBe('Choice 38')
  press('PageUp'); expect(document.activeElement?.textContent).toBe('Choice 30✓')
  press('End'); expect(document.activeElement?.textContent).toBe('Choice 53')
  press('Tab'); expect(document.activeElement?.textContent).toBe('Cancel')
  press('Tab', 0, true); expect(document.activeElement?.textContent).toBe('Choice 53')
  press('Home'); expect(document.activeElement?.textContent).toBe('Choice 0')
  press('ArrowUp'); expect(document.activeElement?.textContent).toBe('Cancel')
  press('ArrowDown'); press('ArrowDown'); expect(document.activeElement?.textContent).toBe('Choice 3')
  expect(picker.value).toBe('30')
})

it.each([461, 10009])('cancels TV Back code %s without leaking navigation to the underlying screen', code => {
  const behind = vi.fn(); document.addEventListener('keydown', behind)
  open(); press('ArrowDown'); expect(press('', code).defaultPrevented).toBe(true)
  expect(picker.value).toBe('blue'); expect(document.activeElement).toBe(picker); expect(behind).not.toHaveBeenCalled()
  document.removeEventListener('keydown', behind)
})

it('honors disabled groups, ignores hidden controls and keeps native behavior if a modal cannot be used', () => {
  const group = document.createElement('optgroup'); group.disabled = true; group.append(new Option('Unavailable', 'x')); picker.append(group)
  open(); expect((dialog().querySelectorAll('button[role=radio]')[4] as HTMLButtonElement).disabled).toBe(true); ui.close()
  picker.disabled = true; expect(press('Enter').defaultPrevented).toBe(false); expect(dialog().open).toBe(false)
  picker.disabled = false; picker.hidden = true; picker.click(); expect(dialog().open).toBe(false); picker.hidden = false
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: undefined })
  picker.focus(); expect(press('Enter').defaultPrevented).toBe(false); expect(dialog().open).toBe(false)
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true }); picker.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
})

it('refuses stale options and closes when an open list changes without overwriting a newer value', async () => {
  const changed = vi.fn(); picker.onchange = changed
  open(); const stale = dialog().querySelectorAll('button[role=radio]')[3] as HTMLButtonElement
  picker.value = 'fuchsia'; stale.click(); expect(picker.value).toBe('fuchsia'); expect(changed).not.toHaveBeenCalled()
  open(); picker.options[0].text = 'New label'; await Promise.resolve(); expect(dialog().open).toBe(false)
  open(); picker.disabled = true; await Promise.resolve(); expect(dialog().open).toBe(false); expect(changed).not.toHaveBeenCalled()
})

it('localizes the modal, bounds its option count and releases its handlers on disposal', async () => {
  await setInterfaceLanguage('fr', async () => ({ Cancel: 'Annuler', 'Up / down to browse · OK to choose · Back to cancel': 'Parcourir · Choisir · Annuler' }))
  open(); expect(dialog().textContent).toContain('Annuler'); expect(dialog().textContent).toContain('Parcourir'); ui.close()
  picker.replaceChildren(...Array.from({ length: 201 }, (_, i) => new Option(`Option ${i}`, String(i))))
  expect(press('Enter').defaultPrevented).toBe(false); expect(dialog().open).toBe(false)
  ui.dispose(); expect(document.getElementById('settings-choice')).toBeNull(); expect(press('Enter').defaultPrevented).toBe(false)
})

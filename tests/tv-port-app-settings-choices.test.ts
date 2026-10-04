// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULTS, readPreferences, savePreferences } from '../tv-app/preferences'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('uses remote choices for real preferences, preserves Back routing and closes on navigation/background', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  savePreferences(localStorage, { ...DEFAULTS, homeRows: ['movies', 'live'], updateChannel: 'beta' })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const press = (key: string, keyCode = 0) => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode, bubbles: true, cancelable: true }))
  }
  el<HTMLSelectElement>('source-kind').value = 'direct'; el('source-kind').dispatchEvent(new Event('change'))
  el<HTMLInputElement>('source-url').value = 'https://example.com/movie.mp4'; await click('connect'); await click('nav-settings')
  el('pref-accent').focus(); press('Enter'); expect(el<HTMLDialogElement>('settings-choice').open).toBe(true)
  expect(document.activeElement?.getAttribute('aria-checked')).toBe('true')
  press('ArrowDown'); press('Enter'); await vi.advanceTimersByTimeAsync(0)
  expect(readPreferences(localStorage).accent).toBe('rose'); expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ffa0b9')
  expect(readPreferences(localStorage).homeRows).toEqual(['movies', 'live']); expect(readPreferences(localStorage).updateChannel).toBe('beta')
  expect(document.activeElement).toBe(el('pref-accent')); expect(el('settings').hidden).toBe(false)
  el('pref-theme').focus(); press('Enter'); press('ArrowDown'); press('', 461)
  expect(readPreferences(localStorage).theme).toBe('dark'); expect(el('settings').hidden).toBe(false); expect(document.activeElement).toBe(el('pref-theme'))
  el('pref-autonext').focus(); press('Enter'); press('ArrowDown'); press('Enter'); await vi.advanceTimersByTimeAsync(0)
  expect(readPreferences(localStorage).autoNext).toBe(true)
  el('pref-scale').focus(); press('Enter'); press('End'); press('Enter'); await vi.advanceTimersByTimeAsync(0)
  expect(readPreferences(localStorage).scale).toBe(1.5)
  expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.5')
  expect(document.activeElement).toBe(el('pref-scale'))
  press('Enter'); press('ArrowUp'); press('', 461)
  expect(readPreferences(localStorage).scale).toBe(1.5)
  expect(el('settings').hidden).toBe(false)
  el('pref-update-channel').focus(); press('Enter'); press('ArrowUp'); press('Enter'); await vi.advanceTimersByTimeAsync(0)
  expect(readPreferences(localStorage).updateChannel).toBe('stable'); expect(readPreferences(localStorage).homeRows).toEqual(['movies', 'live'])
  await click('settings-updates'); expect(el('updates-channel').textContent).toContain('Stable · excludes prereleases'); await click('updates-back')
  el('pref-clock').focus(); press('Enter'); await click('nav-home'); expect(el<HTMLDialogElement>('settings-choice').open).toBe(false)
  await click('nav-settings'); el('pref-language').focus(); press('Enter')
  window.dispatchEvent(new Event('pagehide')); expect(el<HTMLDialogElement>('settings-choice').open).toBe(false)
  expect(readPreferences(localStorage).interfaceLanguage).toBe('auto')
  vi.clearAllTimers()
})

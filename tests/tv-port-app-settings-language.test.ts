// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { readPreferences } from '../tv-app/preferences'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); delete window.LanternfinTranslations })
it('refreshes settings copy, generated choices and save status without changing provider text or chosen values', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n#EXTINF:-1,Home screen\nhttps://example.test/live.m3u8')))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const choose = async (id: string, value: string) => { el<HTMLSelectElement>(id).value = value; el(id).dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0) }
  el<HTMLInputElement>('source-name').value = 'Home screen'; el<HTMLInputElement>('source-url').value = 'https://example.test/list.m3u'
  await click('connect'); await click('nav-settings'); await choose('pref-scale', '1.5'); await choose('pref-overscan', '8')
  const load = async (code: string) => {
    await choose('pref-language', code)
    const script = document.querySelector(`script[src="locale-${code}.js"]`)
    if (script) {
      window.LanternfinTranslations ||= {}; window.LanternfinTranslations[code] = JSON.parse(readFileSync(`tv-app/locales/${code}.json`, 'utf8'))
      script.dispatchEvent(new Event('load')); await vi.advanceTimersByTimeAsync(0)
    }
  }
  await load('fr')
  expect(el('settings-home').textContent).toContain('Écran d’accueil')
  expect(el('settings-note').textContent).toContain('Préférences enregistrées')
  expect(el('library-note').textContent).toContain('Les favoris')
  expect(el<HTMLSelectElement>('pref-language').options[0].text).toBe('Utiliser la langue de l’appareil')
  expect(el<HTMLSelectElement>('pref-clock').options[0].text).toBe('Fuseau horaire de l’appareil')
  expect(el<HTMLSelectElement>('source-guide-offset').selectedOptions[0].text).toBe('Aucune correction')
  el('pref-theme').click()
  expect(el('settings-choice').textContent).toContain('Haut / bas pour parcourir')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(el('pref-theme'))
  await load('ar'); expect(document.documentElement.dir).toBe('rtl')
  expect(el('pref-scale').dir).toBe('ltr'); expect(el('pref-clock').dir).toBe('rtl')
  expect(el('settings-home').textContent).toContain('الشاشة الرئيسية')
  expect(el('settings-note').textContent).toContain('حُفظت التفضيلات')
  expect(readPreferences(localStorage)).toMatchObject({ scale: 1.5, overscan: 8, theme: 'dark' })
  await choose('source-guide-offset', '60')
  expect(el('source-guide-offset').dir).toBe('ltr')
  await click('settings-source')
  await choose('guide-offset', '60'); expect(el('guide-offset').dir).toBe('ltr')
  await click('profile-new')
  expect(el<HTMLSelectElement>('guide-offset').value).toBe('0'); expect(el('guide-offset').dir).toBe('rtl')
  await click('nav-settings')
  await choose('pref-scale', '1.5')
  await load('en'); expect(document.documentElement.dir).toBe('ltr')
  expect(el('settings-home').textContent).toContain('Home screen')
  expect(el('settings-note').textContent).toContain('Preferences saved.')
  await click('settings-back'); expect(el('hero-title').textContent).toBe('Home screen')
  vi.clearAllTimers()
})

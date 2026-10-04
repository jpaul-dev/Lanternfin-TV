// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { LANGUAGE_TOKENS } from '../src/scripts/lib/language-tags'
import { readPreferences } from '../tv-app/preferences'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); delete window.LanternfinTranslations })
it('migrates stored choices and uses the interface language or an exact remote-selected provider tag on Home', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('__TV_TARGET__', 'browser')
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  localStorage.setItem('lanternfin.tv.preferences.v1', JSON.stringify({ groupLanguages: true, contentLanguage: 'fr', interfaceLanguage: 'fr', audio: 'en', subtitles: 'off' }))
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
  vi.stubGlobal('fetch', vi.fn(async () => new Response('#EXTM3U\n' + ['EN', 'FR', 'QC', 'SC'].map((tag, i) => `#EXTINF:-1 tvg-type="movie",${tag} - Film\nhttps://example.com/${i}.mp4\n`).join(''))))
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8'); await import('../tv-app/app')
  window.LanternfinTranslations = { fr: { Home: 'Accueil' } }
  document.querySelector('script[src="locale-fr.js"]')!.dispatchEvent(new Event('load')); await vi.advanceTimersByTimeAsync(0)
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const click = async (id: string) => { el<HTMLButtonElement>(id).click(); await vi.advanceTimersByTimeAsync(0) }
  const press = (key: string) => { for (const type of ['keydown', 'keyup']) document.activeElement!.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })) }
  const choose = async (tag: string) => {
    el('pref-content').focus(); press('Enter')
    const choices = [...el('settings-choice').querySelectorAll<HTMLButtonElement>('[role=radio]')]
    expect(choices).toHaveLength(Object.keys(LANGUAGE_TOKENS).length + 1)
    const choice = tag === 'auto' ? choices[0] : choices.find(item => item.textContent?.includes(`(${tag})`))!
    choice.focus(); press('Enter'); await vi.advanceTimersByTimeAsync(0)
    expect(readPreferences(localStorage).contentLanguage).toBe(tag)
  }
  expect(el<HTMLSelectElement>('pref-content').value).toBe('FR')
  el<HTMLInputElement>('source-url').value = 'https://example.com/list.m3u'; await click('connect')
  await click('nav-settings'); await choose('auto'); await click('settings-back')
  expect(el('hero-title').textContent).toBe('FR - Film'); expect(el('home-rows').querySelectorAll('.channel')).toHaveLength(1)
  await click('nav-settings'); await choose('QC'); await click('settings-back'); expect(el('hero-title').textContent).toBe('QC - Film')
  await click('nav-settings'); await choose('SC'); await click('settings-back'); expect(el('hero-title').textContent).toBe('SC - Film')
  await click('nav-settings'); await choose('auto')
  el<HTMLSelectElement>('pref-language').value = 'en'; el('pref-language').dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0)
  await click('settings-back'); expect(el('hero-title').textContent).toBe('EN - Film')
  expect(readPreferences(localStorage)).toMatchObject({ audio: 'en', subtitles: 'off', contentLanguage: 'auto' })
  vi.clearAllTimers()
})

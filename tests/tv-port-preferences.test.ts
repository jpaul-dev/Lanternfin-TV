// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { DEFAULTS, normalizePreferences, readPreferences, savePreferences, applyPreferences, languageMatch } from '../tv-app/preferences'
beforeEach(() => localStorage.clear())
it('rejects invalid settings and prototype keys while preserving supported choices', () => {
  expect(normalizePreferences({ theme: 'invalid', accent: '__proto__', scale: 99, overscan: -2, audio: 'constructor', subtitles: 'bad', guideClock: 'Infinity' })).toEqual(DEFAULTS)
  expect(normalizePreferences({ theme: 'light', accent: 'cyan', scale: 1.3, overscan: 8, reducedMotion: true, audio: 'fr', subtitles: 'en', guideClock: '-420' })).toMatchObject({ theme: 'light', accent: 'cyan', scale: 1.3, overscan: 8, guideClock: '-420' })
})
it('restores preferences separately from source credentials and applies accessible sizing', () => {
  const preferences = { ...DEFAULTS, theme: 'light' as const, scale: 1.15, overscan: 3, reducedMotion: true, audio: 'fr' }
  savePreferences(localStorage, preferences); expect(readPreferences(localStorage)).toEqual(preferences)
  applyPreferences(preferences)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.style.getPropertyValue('--safe-y')).toBe('3vh')
  expect(document.documentElement.dataset.motion).toBe('reduced')
})
it('matches regional and ISO three-letter track language codes', () => {
  expect(languageMatch('fre', 'fr-FR')).toBe(true); expect(languageMatch('eng', 'en')).toBe(true)
  expect(languageMatch('pt-PT', 'pt-BR')).toBe(true); expect(languageMatch('es', 'en')).toBe(false)
})
it('retains every Android text-size preset across persistence and rejects malformed sizes', () => {
  for (const scale of [.875, 1, 1.125, 1.25, 1.5]) {
    savePreferences(localStorage, { ...DEFAULTS, scale, overscan: 8 })
    const restored = readPreferences(localStorage)
    expect(restored.scale).toBe(scale)
    applyPreferences(restored)
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe(String(scale))
    expect(document.documentElement.dataset.largeUi).toBe('true')
  }
  for (const scale of [0, 1.6, '1.5', null, [1.5], NaN, Infinity]) expect(normalizePreferences({ scale }).scale).toBe(1)
})
it('defaults old or invalid update channels to stable and persists an explicit beta choice', () => {
  for (const updateChannel of [undefined, null, 'nightly', 'constructor', true, ['beta']]) expect(normalizePreferences({ updateChannel }).updateChannel).toBe('stable')
  savePreferences(localStorage, { ...DEFAULTS, updateChannel: 'beta' })
  expect(readPreferences(localStorage).updateChannel).toBe('beta')
})

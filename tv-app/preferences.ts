export const ACCENTS = { fuchsia: ['#e68bdf', '#96368f'], rose: ['#ffa0b9', '#a82b50'], ember: ['#ffba86', '#9f480b'], emerald: ['#7cddba', '#126448'], cyan: ['#82dce7', '#086876'], blue: ['#98bcff', '#285eac'], violet: ['#bdabff', '#6743b9'], gold: ['#f2d279', '#795b00'], lime: ['#c4df85', '#536f09'], teal: ['#8dddd0', '#106a5c'], silver: ['#c3ccd6', '#566473'], white: ['#f4f6f8', '#343e49'] } as const
export const LANGUAGES = { auto: 'Automatic', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', 'pt-BR': 'Português', nl: 'Nederlands', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', ar: 'العربية', hi: 'हिन्दी', ja: '日本語', zh: '中文' } as const
export type Preferences = { theme: 'dark' | 'light' | 'system'; accent: keyof typeof ACCENTS; scale: number; overscan: number; reducedMotion: boolean; audio: string; subtitles: string; guideClock: string }
export const DEFAULTS: Preferences = { theme: 'dark', accent: 'fuchsia', scale: 1, overscan: 0, reducedMotion: false, audio: 'auto', subtitles: 'off', guideClock: 'auto' }
const KEY = 'lanternfin.tv.preferences.v1'
const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
export function normalizePreferences(raw: unknown): Preferences {
  const result = { ...DEFAULTS }, value = raw && typeof raw === 'object' ? raw as Partial<Preferences> : {}
  if (['dark', 'light', 'system'].includes(value.theme || '')) result.theme = value.theme!
  if (owns(ACCENTS, value.accent || '')) result.accent = value.accent!
  if ([.85, 1, 1.15, 1.3].includes(value.scale || 0)) result.scale = value.scale!
  if ([0, 1, 2, 3, 4, 5, 6, 7, 8].includes(value.overscan ?? -1)) result.overscan = value.overscan!
  if (typeof value.reducedMotion === 'boolean') result.reducedMotion = value.reducedMotion
  if (owns(LANGUAGES, value.audio || '')) result.audio = value.audio!
  if (value.subtitles === 'off' || owns(LANGUAGES, value.subtitles || '')) result.subtitles = value.subtitles!
  if (value.guideClock === 'auto' || (typeof value.guideClock === 'string' && /^-?\d+$/.test(value.guideClock) && Number(value.guideClock) >= -720 && Number(value.guideClock) <= 840 && Number(value.guideClock) % 30 === 0)) result.guideClock = value.guideClock!
  return result
}
export function readPreferences(storage: Storage | null): Preferences { try { const raw = storage?.getItem(KEY) || '{}'; return normalizePreferences(raw.length <= 4096 ? JSON.parse(raw) : {}) } catch { return { ...DEFAULTS } } }
export function savePreferences(storage: Storage | null, preferences: Preferences) { storage?.setItem(KEY, JSON.stringify(normalizePreferences(preferences))) }
export function applyPreferences(preferences: Preferences, root = document.documentElement) {
  const light = preferences.theme === 'light' || preferences.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches
  root.dataset.theme = light ? 'light' : 'dark'; root.dataset.motion = preferences.reducedMotion ? 'reduced' : 'normal'
  root.dataset.largeUi = String(preferences.scale > 1 || preferences.overscan >= 5)
  root.style.setProperty('--accent', ACCENTS[preferences.accent][light ? 1 : 0]); root.style.setProperty('--text-scale', String(preferences.scale))
  root.style.setProperty('--safe-x', `${preferences.overscan}vw`); root.style.setProperty('--safe-y', `${preferences.overscan}vh`)
}
const LANGUAGE_ALIASES: Record<string, string> = { eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', pol: 'pl', tur: 'tr', rus: 'ru', ara: 'ar', hin: 'hi', jpn: 'ja', zho: 'zh', chi: 'zh' }
export function languageMatch(actual: string | undefined, preferred: string) {
  const primary = (value: string) => { const base = value.toLowerCase().split(/[-_]/)[0]; return LANGUAGE_ALIASES[base] || base }
  return !!actual && primary(actual) === primary(preferred)
}

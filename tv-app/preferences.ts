import { ACCENTS, isAccent, resolveAccent, type Accent, type AccentChoice } from './accent'
export { ACCENTS } from './accent'
export const LANGUAGES = { auto: 'Automatic', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano', 'pt-BR': 'Português', nl: 'Nederlands', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', ar: 'العربية', hi: 'हिन्दी', ja: '日本語', zh: '中文' } as const
import { INTERFACE_LANGUAGES } from './i18n'
import { DEFAULT_HOME_ROWS, normalizeHomeRows, type HomeRow } from './home-config'
export type UpdateChannel = 'stable' | 'beta'
export type Preferences = { theme: 'dark' | 'light' | 'system'; accent: AccentChoice; scale: number; overscan: number; reducedMotion: boolean; audio: string; subtitles: string; guideClock: string; autoNext: boolean; groupLanguages: boolean; contentLanguage: string; interfaceLanguage: string; homeRows: HomeRow[]; updateChannel: UpdateChannel }
export const DEFAULTS: Preferences = { theme: 'dark', accent: 'fuchsia', scale: 1, overscan: 0, reducedMotion: false, audio: 'auto', subtitles: 'off', guideClock: 'auto', autoNext: false, groupLanguages: false, contentLanguage: 'auto', interfaceLanguage: 'auto', homeRows: [...DEFAULT_HOME_ROWS], updateChannel: 'stable' }
const KEY = 'lanternfin.tv.preferences.v1'
const owns = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
export function normalizePreferences(raw: unknown): Preferences {
  const result = { ...DEFAULTS }, value = raw && typeof raw === 'object' ? raw as Partial<Preferences> : {}
  result.homeRows = normalizeHomeRows(value.homeRows)
  if (value.updateChannel === 'stable' || value.updateChannel === 'beta') result.updateChannel = value.updateChannel
  if (['dark', 'light', 'system'].includes(value.theme || '')) result.theme = value.theme!
  if (value.accent === 'random' || isAccent(value.accent)) result.accent = value.accent
  if ([.85, 1, 1.15, 1.3].includes(value.scale || 0)) result.scale = value.scale!
  if ([0, 1, 2, 3, 4, 5, 6, 7, 8].includes(value.overscan ?? -1)) result.overscan = value.overscan!
  if (typeof value.reducedMotion === 'boolean') result.reducedMotion = value.reducedMotion
  if (typeof value.autoNext === 'boolean') result.autoNext = value.autoNext
  if (typeof value.groupLanguages === 'boolean') result.groupLanguages = value.groupLanguages
  if (owns(LANGUAGES, value.contentLanguage || '')) result.contentLanguage = value.contentLanguage!
  if (owns(INTERFACE_LANGUAGES, value.interfaceLanguage || '')) result.interfaceLanguage = value.interfaceLanguage!
  if (owns(LANGUAGES, value.audio || '')) result.audio = value.audio!
  if (value.subtitles === 'off' || owns(LANGUAGES, value.subtitles || '')) result.subtitles = value.subtitles!
  if (value.guideClock === 'auto' || (typeof value.guideClock === 'string' && /^-?\d+$/.test(value.guideClock) && Number(value.guideClock) >= -720 && Number(value.guideClock) <= 840 && Number(value.guideClock) % 30 === 0)) result.guideClock = value.guideClock!
  return result
}
export function readPreferences(storage: Storage | null): Preferences { try { const raw = storage?.getItem(KEY) || '{}'; return normalizePreferences(raw.length <= 4096 ? JSON.parse(raw) : {}) } catch { return normalizePreferences({}) } }
export function savePreferences(storage: Storage | null, preferences: Preferences) { storage?.setItem(KEY, JSON.stringify(normalizePreferences(preferences))) }
export function applyPreferences(preferences: Preferences, root = document.documentElement, sourceColor?: Accent) {
  const light = preferences.theme === 'light' || preferences.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches
  root.dataset.theme = light ? 'light' : 'dark'; root.dataset.motion = preferences.reducedMotion ? 'reduced' : 'normal'
  root.dataset.largeUi = String(preferences.scale > 1 || preferences.overscan >= 5)
  const color = sourceColor || resolveAccent(preferences.accent)
  root.dataset.accent = color
  root.style.setProperty('--accent', ACCENTS[color][light ? 1 : 0]); root.style.setProperty('--text-scale', String(preferences.scale))
  root.style.setProperty('--safe-x', `${preferences.overscan}vw`); root.style.setProperty('--safe-y', `${preferences.overscan}vh`)
}
const LANGUAGE_ALIASES: Record<string, string> = { eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', pol: 'pl', tur: 'tr', rus: 'ru', ara: 'ar', hin: 'hi', jpn: 'ja', zho: 'zh', chi: 'zh' }
function languageKey(value: string) { const [base, ...region] = value.trim().toLowerCase().split(/[-_]/); return [LANGUAGE_ALIASES[base] || base, ...region].join('-') }
export function languageScore(actual: string | undefined, preferred: string): number {
  if (!actual) return 0
  const a = languageKey(actual), p = languageKey(preferred)
  if (!a || !p || a === 'und' || p === 'und') return 0
  return a === p ? 2 : a.split('-')[0] === p.split('-')[0] ? 1 : 0
}
export function languageMatch(actual: string | undefined, preferred: string) {
  return languageScore(actual, preferred) > 0
}

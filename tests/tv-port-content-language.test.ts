import { afterEach, expect, it, vi } from 'vitest'
import { LANGUAGE_TOKENS } from '../src/scripts/lib/language-tags'
import { contentLanguageChoices, contentLanguageTags, normalizeContentLanguage } from '../tv-app/content-language'
import { preferredVariant } from '../tv-app/variants'
import { normalizePreferences, readPreferences, savePreferences } from '../tv-app/preferences'
import { createBackup, MemoryStore, restoreBackup } from '../tv-app/backup'
import type { Channel } from '../tv-app/catalog'

afterEach(() => vi.restoreAllMocks())
const movie = (prefix: string): Channel => ({ name: `${prefix} - Film`, group: 'Movies', mediaKind: 'movie', url: `https://example.com/${prefix}.mp4` })
it('offers every original provider token distinctly, including regional and non-language aliases', () => {
  const choices = contentLanguageChoices('en')
  expect(new Set(choices.map(item => item.value))).toEqual(new Set(Object.keys(LANGUAGE_TOKENS)))
  for (const tag of Object.keys(LANGUAGE_TOKENS)) expect(normalizeContentLanguage(tag)).toBe(tag)
  expect(choices.find(item => item.value === 'QC')?.label).toContain('(QC)')
  expect(choices.find(item => item.value === 'SC')?.label).toBe('Nordic (SC)')
  expect(choices.find(item => item.value === 'IN')?.label).toBe('Indian (IN)')
})
it('keeps readable packaged labels when Intl.DisplayNames is unavailable', () => {
  vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => { throw new Error('Not supported') })
  const choices = contentLanguageChoices('en-001')
  expect(choices.find(item => item.value === 'SE')?.label).toBe('Swedish (SE)')
  expect(choices.find(item => item.value === 'QC')?.label).toBe('French (Canada) (QC)')
  expect(choices.find(item => item.value === 'GR')?.label).toBe('Greek (GR)')
  for (const item of choices) expect(item.label).not.toBe(`${item.value} (${item.value})`)
})
it('migrates earlier portable language choices in storage and backups without touching audio or captions', () => {
  const memory = new MemoryStore(), target = new MemoryStore()
  for (const [before, after] of [['fr', 'FR'], ['pt-BR', 'BR'], ['zh', 'CN'], ['auto', 'auto']]) {
    memory.setItem('lanternfin.tv.preferences.v1', JSON.stringify({ contentLanguage: before, audio: 'fr', subtitles: 'en' }))
    expect(readPreferences(memory)).toMatchObject({ contentLanguage: after, audio: 'fr', subtitles: 'en' })
    const backup = createBackup(memory); backup.preferences.contentLanguage = before
    restoreBackup(target, backup, { preferences: true, library: false })
    expect(readPreferences(target).contentLanguage).toBe(after)
  }
  for (const value of ['QC', 'SC', 'PK', 'IN']) { savePreferences(memory, normalizePreferences({ contentLanguage: value })); expect(readPreferences(memory).contentLanguage).toBe(value) }
  for (const invalid of ['constructor', '__proto__', 'unknown', '', null, 4]) expect(normalizeContentLanguage(invalid)).toBe('auto')
})
it('uses interface language for Automatic and retains region, alias and English fallback ordering', () => {
  expect(contentLanguageTags('auto', 'fr')).toEqual(['FR', 'QC', 'EN'])
  expect(contentLanguageTags('auto', 'ur')).toEqual(['UR', 'PK', 'EN'])
  expect(contentLanguageTags('auto', 'pt-BR')).toEqual(['BR', 'PT', 'EN'])
  expect(contentLanguageTags('auto', '__proto__')).toEqual(['EN'])
  expect(contentLanguageTags('QC', 'de')).toEqual(['QC', 'FR', 'DE', 'EN'])
  expect(contentLanguageTags('PK', 'en')).toEqual(['PK', 'UR', 'EN'])
  expect(contentLanguageTags('SC', 'fr')).toEqual(['SC', 'FR', 'QC', 'EN'])
})
it('prefers exact provider choices while keeping available fallback versions and stable quality ties', () => {
  const english = movie('EN'), french = movie('FR'), canadian = movie('QC'), nordic = movie('SC'), quality = movie('4K-QC'), same = movie('QC')
  expect(preferredVariant([english, french, quality, canadian], contentLanguageTags('QC', 'en'))).toBe(canadian)
  expect(preferredVariant([english, french], contentLanguageTags('QC', 'en'))).toBe(french)
  expect(preferredVariant([english, nordic, french], contentLanguageTags('SC', 'fr'))).toBe(nordic)
  expect(preferredVariant([same, canadian], contentLanguageTags('QC', 'en'))).toBe(same)
  expect(preferredVariant([movie('UR'), movie('PK')], contentLanguageTags('PK', 'en')).name).toBe('PK - Film')
})

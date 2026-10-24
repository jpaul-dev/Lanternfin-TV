// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ACCENTS, clearAccentRoll, resolveAccent, sourceAccent } from '../tv-app/accent'
import { DEFAULTS, applyPreferences, readPreferences, savePreferences } from '../tv-app/preferences'
import { readProfiles, rememberProfile, saveSourceAccent, sourceId } from '../tv-app/profiles'
import { createBackup, decryptBackup, encryptBackup, MemoryStore, restoreBackup, validateBackup } from '../tv-app/backup'

const source = { kind: 'playlist' as const, url: 'https://example.test/list.m3u', username: '', password: '' }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearAccentRoll() })
afterEach(() => { vi.restoreAllMocks() })

it('keeps one random roll across preference changes and honors an existing session roll after a fresh import', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.4)
  savePreferences(localStorage, { ...DEFAULTS, accent: 'random' })
  applyPreferences(readPreferences(localStorage)); const color = document.documentElement.dataset.accent!
  expect(color in ACCENTS).toBe(true); expect(sessionStorage.getItem('lanternfin.tv.accent-roll.v1')).toBe(color)
  vi.mocked(Math.random).mockReturnValue(0.95)
  applyPreferences({ ...readPreferences(localStorage), scale: 1.3, theme: 'light' })
  expect(document.documentElement.dataset.accent).toBe(color)
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe(ACCENTS[color as keyof typeof ACCENTS][1])
  vi.resetModules(); const fresh = await import('../tv-app/accent')
  expect(fresh.resolveAccent('random')).toBe(color)
  clearAccentRoll(); expect(resolveAccent('random')).not.toBe(color)
})

it('keeps a stable random accent if session storage denies reads or writes, including an explicit reroll', () => {
  const blocked = { getItem() { return 'blue' }, setItem() { throw new Error('full') }, removeItem() { throw new Error('denied') } } as unknown as Storage
  clearAccentRoll(blocked); vi.spyOn(Math, 'random').mockReturnValue(0)
  expect(resolveAccent('random', blocked)).toBe('fuchsia')
  vi.mocked(Math.random).mockReturnValue(0.95); expect(resolveAccent('random', blocked)).toBe('fuchsia')
  clearAccentRoll(blocked); expect(resolveAccent('random', blocked)).toBe('white')
})

it('applies a source override in both themes without changing the saved global accent', () => {
  savePreferences(localStorage, { ...DEFAULTS, accent: 'random' })
  applyPreferences(readPreferences(localStorage), document.documentElement, 'cyan')
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe(ACCENTS.cyan[0])
  applyPreferences({ ...readPreferences(localStorage), theme: 'light' }, document.documentElement, 'cyan')
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe(ACCENTS.cyan[1])
  expect(readPreferences(localStorage).accent).toBe('random')
  for (const invalid of ['random', '__proto__', 'constructor', '#ffffff', null]) expect(() => sourceAccent(invalid)).toThrow('listed source')
  expect(sourceAccent('')).toBeUndefined()
})

it('persists and clears source accents without changing source identity or recreating removed credentials', () => {
  const id = sourceId(source)
  expect(saveSourceAccent(localStorage, source, 'cyan')).toBe(false); expect(localStorage.length).toBe(0)
  rememberProfile(localStorage, source, 'Source', undefined, { accent: 'cyan', guideOffset: 60 })
  expect(readProfiles(localStorage)[0]).toMatchObject({ id, accent: 'cyan', guideOffset: 60 })
  saveSourceAccent(localStorage, source, 'rose'); expect(readProfiles(localStorage)[0].accent).toBe('rose')
  saveSourceAccent(localStorage, source); expect(readProfiles(localStorage)[0].accent).toBeUndefined()
  expect(readProfiles(localStorage)[0].id).toBe(id)
  const entries = JSON.parse(localStorage.getItem('lanternfin.tv.profiles.v1')!); entries[0].accent = '__proto__'
  localStorage.setItem('lanternfin.tv.profiles.v1', JSON.stringify(entries))
  expect(readProfiles(localStorage)).toHaveLength(1); expect(readProfiles(localStorage)[0].accent).toBeUndefined()
})

it('round-trips source accents and random preference through encrypted backup while retaining existing source choices', async () => {
  rememberProfile(localStorage, source, 'Source', undefined, { accent: 'gold' }); savePreferences(localStorage, { ...DEFAULTS, accent: 'random' })
  const crypto = webcrypto as unknown as Crypto, passphrase = 'local test passphrase'
  const backup = await decryptBackup(await encryptBackup(createBackup(localStorage), passphrase, crypto), passphrase, crypto)
  const target = new MemoryStore(); restoreBackup(target, backup, { library: true, preferences: true })
  expect(readProfiles(target)[0].accent).toBe('gold'); expect(readPreferences(target).accent).toBe('random')
  saveSourceAccent(target, source, 'rose'); restoreBackup(target, backup, { library: true, preferences: true })
  expect(readProfiles(target)[0].accent).toBe('rose')
  const invalid = structuredClone(backup); (invalid.profiles[0] as any).accent = 'url(secret)'
  expect(() => validateBackup(invalid)).toThrow('supported')
  const legacy = structuredClone(backup); delete legacy.profiles[0].accent
  expect(validateBackup(legacy).profiles[0].accent).toBeUndefined()
})

import { webcrypto } from 'node:crypto'
import { expect, it } from 'vitest'
import { createBackup, decryptBackup, encryptBackup, restoreBackup, validateBackup, MemoryStore, BACKUP_TEXT } from '../tv-app/backup'
import { TVLibrary, channelId } from '../tv-app/library'
import { readProfiles, rememberProfile } from '../tv-app/profiles'
import { savePreferences, readPreferences, DEFAULTS } from '../tv-app/preferences'
import { readSource } from '../tv-app/storage'
import { mediaUrl } from '../tv-app/xtream'
import type { Source } from '../tv-app/catalog'
const crypto = webcrypto as unknown as Crypto, passphrase = 'test backup passphrase only'
const source: Source = { kind: 'xtream', url: 'https://provider.example/', username: 'private-user', password: 'private-password' }
const channel = { name: 'A title', group: 'Movies', mediaKind: 'movie' as const, providerId: '42', categoryId: '1', rating: 8.2, year: '2024', url: mediaUrl(source, 'movie', '42', 'mp4') }
function fixture() {
  const storage = new MemoryStore(); rememberProfile(storage, source, 'My TV', undefined, { guideUrl: 'https://guide.example/list.xml', keepLibrary: true, guideOffset: 90 })
  const library = new TVLibrary(storage, source); library.toggleFavorite(channel); library.record(channel, 120, 600); library.markWatched(channel, true)
  library.setBrowseChoice('movie', { sort: 'rating', watched: 'unwatched', language: 'FR', media: '' })
  return { storage, backup: createBackup(storage) }
}
it('encrypts and restores byte-authenticated backups with fresh salts and no readable credentials', async () => {
  const { backup } = fixture()
  const first = await encryptBackup(backup, passphrase, crypto), second = await encryptBackup(backup, passphrase, crypto)
  expect(first).not.toEqual(second); expect(first).not.toContain('private'); expect(first).not.toContain('provider.example')
  expect(await decryptBackup(first, passphrase, crypto)).toEqual(backup)
  expect(backup.profiles[0].library.references[0]).toMatchObject({ categoryId: '1', rating: 8.2, year: '2024' })
  const decrypted = await decryptBackup(first, passphrase, crypto), target = new MemoryStore()
  restoreBackup(target, decrypted, { library: true, preferences: false })
  expect(readProfiles(target)[0].guideOffset).toBe(90)
  expect(new TVLibrary(target, source).browseChoice('movie')).toEqual({ sort: 'rating', watched: 'unwatched', language: 'FR', media: '' })
  await expect(decryptBackup(first, 'wrong password long enough', crypto)).rejects.toThrow('incorrect')
  const edited = JSON.parse(first); edited.data = (edited.data[0] === 'A' ? 'B' : 'A') + edited.data.slice(1)
  await expect(decryptBackup(JSON.stringify(edited), passphrase, crypto)).rejects.toThrow('damaged')
})
it('rejects plaintext, oversized input, unsafe sources and unbounded derivation work', async () => {
  const { backup } = fixture()
  await expect(decryptBackup(JSON.stringify(backup), passphrase, crypto)).rejects.toThrow('supported')
  await expect(decryptBackup('x'.repeat(BACKUP_TEXT + 1), passphrase, crypto)).rejects.toThrow('limits')
  await expect(encryptBackup(backup, 'short', crypto)).rejects.toThrow('12')
  await expect(decryptBackup('{"format":"lanternfin-encrypted","version":1,"iterations":999999999}', passphrase, crypto)).rejects.toThrow('supported')
  backup.profiles[0].source.url = 'javascript:private-password'; expect(() => validateBackup(backup)).toThrow()
})
it('merges favorites and latest history, keeps existing profile settings, and only imports requested preferences', () => {
  const { backup } = fixture(), target = new MemoryStore()
  rememberProfile(target, source, 'Existing name'); savePreferences(target, { ...DEFAULTS, accent: 'blue' })
  const second = { ...channel, providerId: '43', url: mediaUrl(source, 'movie', '43', 'mp4') }
  const existing = new TVLibrary(target, source); existing.toggleFavorite(second); existing.record(channel, 200, 600)
  const before = new TVLibrary(target, source).lastPlayed(channel)!.at
  backup.profiles[0].library.recent[0].at = before - 1000
  expect(restoreBackup(target, backup, { library: true, preferences: false })).toBe(1)
  expect(readProfiles(target)[0].name).toBe('Existing name'); expect(readProfiles(target)[0].guideUrl).toBeUndefined()
  const restored = new TVLibrary(target, source)
  expect(restored.isFavorite(channel)).toBe(true); expect(restored.isFavorite(second)).toBe(true)
  expect(restored.lastPlayed(channel)?.position).toBe(200); expect(restored.isWatched(channel)).toBe(true)
  expect(readPreferences(target).accent).toBe('blue'); expect(readSource(target)).toEqual(source)
  restoreBackup(target, backup, { library: false, preferences: true }); expect(readPreferences(target).accent).toBe(DEFAULTS.accent)
  expect(new TVLibrary(target, source).favorites.size).toBe(2)
})
it('validates every record before any write and cannot import arbitrary storage keys', () => {
  const { backup } = fixture(), target = new MemoryStore(); target.setItem('unrelated-private-data', 'keep')
  backup.profiles[0].library.favorites.push('invalid')
  expect(() => restoreBackup(target, backup, { library: true, preferences: true })).toThrow('supported'); expect(target.length).toBe(1)
  backup.profiles[0].library.favorites.pop(); (backup as any).storage = { 'unrelated-private-data': 'changed' }
  restoreBackup(target, backup, { library: true, preferences: false }); expect(target.getItem('unrelated-private-data')).toBe('keep')
  expect(new TVLibrary(target, source).favorites.has(channelId(channel))).toBe(true)
})
it('rolls back applied keys when a later storage write fails', () => {
  const { backup } = fixture(), target = new MemoryStore(); target.setItem('unrelated', 'keep')
  const set = target.setItem.bind(target); let count = 0
  target.setItem = (key, value) => { if (++count === 3) throw new Error('quota'); set(key, value) }
  expect(() => restoreBackup(target, backup, { library: true, preferences: true })).toThrow('previous saved data was restored')
  expect(target.length).toBe(1); expect(target.getItem('unrelated')).toBe('keep')
})
it('can restore sources without their library and rejects duplicate profiles or too many sources', () => {
  const { backup } = fixture(), target = new MemoryStore()
  restoreBackup(target, backup, { library: false, preferences: false }); expect(new TVLibrary(target, source).favorites.size).toBe(0)
  expect(readProfiles(target)).toHaveLength(1)
  backup.profiles.push(backup.profiles[0]); expect(() => validateBackup(backup)).toThrow('supported')
})

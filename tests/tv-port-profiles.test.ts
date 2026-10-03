// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { guideAddress, readProfiles, rememberProfile, removeProfile, forgetProfiles } from '../tv-app/profiles'
import { readSource, storeSource } from '../tv-app/storage'
import { TVLibrary, forgetLibrary } from '../tv-app/library'
import type { Source } from '../tv-app/catalog'
const source = (id: number): Source => ({ kind: 'xtream', url: `https://provider${id}.example/`, username: 'test', password: 'example-secret' })
beforeEach(() => localStorage.clear())
it('stores a source-specific guide override without changing the library identity', () => {
  rememberProfile(localStorage, source(1), 'TV'); const id = readProfiles(localStorage)[0].id
  rememberProfile(localStorage, source(1), 'TV', source(1), { guideUrl: 'https://guide.example/guide.xml.gz?token=test' })
  expect(readProfiles(localStorage)[0]).toMatchObject({ id, guideUrl: 'https://guide.example/guide.xml.gz?token=test' })
  expect(readProfiles(localStorage)).toHaveLength(1)
  for (const invalid of ['file:///etc/passwd', 'javascript:alert(1)', 'https://u:p@example.com', 'x'.repeat(8193)]) expect(() => guideAddress(invalid)).toThrow()
  removeProfile(localStorage, source(1)); expect(localStorage.length).toBe(0)
})
it('migrates the opted-in legacy account and supports independent named sources', () => {
  storeSource(localStorage, source(1)); expect(readProfiles(localStorage)).toHaveLength(1)
  rememberProfile(localStorage, source(2), 'Second TV library')
  expect(readProfiles(localStorage).map(profile => profile.name)).toEqual(['Xtream account', 'Second TV library'])
  rememberProfile(localStorage, source(2), 'Renamed'); expect(readProfiles(localStorage)).toHaveLength(2)
  expect(readProfiles(localStorage)[1].name).toBe('Renamed'); expect(readSource(localStorage)).toEqual(source(2))
})
it('editing a saved address replaces its credentials instead of retaining a duplicate', () => {
  rememberProfile(localStorage, source(1), 'TV'); rememberProfile(localStorage, source(2), 'TV', source(1))
  expect(readProfiles(localStorage)).toHaveLength(1); expect(readProfiles(localStorage)[0].source).toEqual(source(2))
})
it('removing one source clears its library without affecting another saved account', () => {
  const channel = { name: 'Test', group: 'Test', url: 'https://example.com/test.m3u8' }
  for (const id of [1, 2]) { rememberProfile(localStorage, source(id), `TV ${id}`); new TVLibrary(localStorage, source(id)).toggleFavorite(channel) }
  removeProfile(localStorage, source(2)); forgetLibrary(localStorage, source(2))
  expect(readSource(localStorage)).toBeNull(); expect(readProfiles(localStorage).map(profile => profile.source)).toEqual([source(1)])
  expect(new TVLibrary(localStorage, source(1)).isFavorite(channel)).toBe(true)
  expect(new TVLibrary(localStorage, source(2)).isFavorite(channel)).toBe(false)
  forgetProfiles(localStorage); expect(readProfiles(localStorage)).toEqual([])
})
it('bounds stored profiles and rejects malformed accounts without losing valid entries', () => {
  for (let id = 0; id < 20; id++) rememberProfile(localStorage, source(id), 'x'.repeat(100))
  expect(readProfiles(localStorage)[0].name).toHaveLength(80)
  expect(() => rememberProfile(localStorage, source(21), 'Extra')).toThrow('20 sources')
  localStorage.setItem('lanternfin.tv.profiles.v1', JSON.stringify([{ source: { ...source(1), url: 'javascript:alert(1)' } }, { name: 'Good', source: source(2) }]))
  expect(readProfiles(localStorage).some(profile => profile.source.url.startsWith('javascript:'))).toBe(false)
  expect(readProfiles(localStorage)[0].name).toBe('Good')
})

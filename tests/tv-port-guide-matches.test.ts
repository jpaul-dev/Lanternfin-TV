// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { guideName, guideNameIndex, MAX_GUIDE_MATCHES } from '../tv-app/guide-matches'
import { TVLibrary, channelId } from '../tv-app/library'
import { MemoryStore, createBackup, encryptBackup, decryptBackup, restoreBackup } from '../tv-app/backup'
import { rememberProfile } from '../tv-app/profiles'
import { XMLTVGuide } from '../tv-app/xmltv'
import { TVGuide } from '../tv-app/guide'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
const source = { kind: 'playlist' as const, url: 'https://example.test/list.m3u', username: '', password: '' }
const channel = (n = 0) => ({ name: `Channel ${n}`, group: '', mediaKind: 'live' as const, url: `https://example.test/live/${n}` })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('matches quality/accent variations but keeps time-shifted and ambiguous channels distinct', () => {
  expect(guideName('Néws HD')).toBe('news'); expect(guideName('News H.265')).toBe('news')
  expect(guideName('News +1 UHD')).toBe('news+1'); expect(guideName('News 1')).toBe('news1')
  const names = guideNameIndex([['a', 'News HD'], ['b', 'News'], ['c', 'Néws UHD'], ['plus', 'News +1'], ['one', 'News 1'], ['ar', 'أخبار HD']])
  expect(names.get('news')).toBe(''); expect(names.get('news+1')).toBe('plus'); expect(names.get('news1')).toBe('one'); expect(names.get(guideName('أخبار'))).toBe('ar')
})

it('keeps remembered matches isolated by source, session-only until opted in, and independent of snapshots', () => {
  const storage = new MemoryStore(), library = new TVLibrary(null, source)
  library.setGuideMatch(channel(), 'Provider.News'); expect(storage.length).toBe(0)
  expect(library.guideMatch(channel())).toBe('provider.news')
  library.snapshot().guideMatches![0][1] = 'changed'; expect(library.guideMatch(channel())).toBe('provider.news')
  library.setStorage(storage); expect(new TVLibrary(storage, source).guideMatch(channel())).toBe('provider.news')
  expect(new TVLibrary(storage, { ...source, url: 'https://other.test/list' }).guideMatch(channel())).toBeUndefined()
  library.setGuideMatch(channel()); expect(new TVLibrary(storage, source).guideMatch(channel())).toBeUndefined()
  expect(() => library.setGuideMatch({ ...channel(), mediaKind: 'movie' }, 'id')).toThrow('live stream')
})

it('preserves the previous match when writes fail or another library instance has changed storage', () => {
  const storage = new MemoryStore(), library = new TVLibrary(storage, source)
  library.setGuideMatch(channel(), 'original'); const stale = new TVLibrary(storage, source)
  library.setGuideMatch(channel(), 'new'); expect(() => stale.setGuideMatch(channel(), 'stale')).toThrow()
  const before = storage.getItem(storage.key(0)!)
  vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(() => library.setGuideMatch(channel(), 'lost')).toThrow('previous match was kept')
  expect(library.guideMatch(channel())).toBe('new'); expect(storage.getItem(storage.key(0)!)).toBe(before)
})

it('bounds saved matches without evicting older choices and rejects oversized merges before changing data', () => {
  const library = new TVLibrary(null, source)
  for (let n = 0; n < MAX_GUIDE_MATCHES; n++) library.setGuideMatch(channel(n), `id-${n}`)
  expect(() => library.setGuideMatch(channel(1000), 'extra')).toThrow('1,000')
  library.setGuideMatch(channel(), 'revised'); expect(library.guideMatch(channel())).toBe('revised')
  const incoming = new TVLibrary(null, source); incoming.setGuideMatch(channel(1000), 'incoming'); incoming.toggleFavorite(channel(1000))
  expect(() => library.merge(incoming)).toThrow('1,000'); expect(library.isFavorite(channel(1000))).toBe(false)
  library.setGuideMatch(channel(1)); library.merge(incoming); expect(library.guideMatch(channel(1000))).toBe('incoming')
})

it('round-trips encrypted matches, keeps current choices on merge, and honors library opt-out and legacy backups', async () => {
  const storage = new MemoryStore(); rememberProfile(storage, source, 'Guide source')
  const incoming = new TVLibrary(storage, source); incoming.setGuideMatch(channel(), 'incoming'); incoming.setGuideMatch(channel(1), 'second')
  const crypto = webcrypto as unknown as Crypto, password = 'guide backup passphrase'
  const backup = await decryptBackup(await encryptBackup(createBackup(storage), password, crypto), password, crypto)
  const target = new MemoryStore(), existing = new TVLibrary(target, source); existing.setGuideMatch(channel(), 'current')
  restoreBackup(target, backup, { library: true, preferences: false })
  const result = new TVLibrary(target, source); expect(result.guideMatch(channel())).toBe('current'); expect(result.guideMatch(channel(1))).toBe('second')
  const excluded = new MemoryStore(); restoreBackup(excluded, backup, { library: false, preferences: false })
  expect(new TVLibrary(excluded, source).guideMatch(channel())).toBeUndefined()
  delete backup.profiles[0].library.guideMatches
  expect(() => restoreBackup(new MemoryStore(), backup, { library: true, preferences: false })).not.toThrow()
})

it.each([null, {}, [['invalid', 'id']], [[channelId(channel()), 'bad\nvalue']], [[channelId(channel()), 'x'.repeat(513)]], [[channelId(channel()), 'id'], [channelId(channel()), 'other']]].map(matches => ({ matches })))('rejects malformed imported matches before writing: $matches', ({ matches }) => {
  const storage = new MemoryStore(); rememberProfile(storage, source, 'Source'); const backup = createBackup(storage)
  ;(backup.profiles[0].library as any).guideMatches = matches
  const target = new MemoryStore(); target.setItem('keep', 'unchanged')
  expect(() => restoreBackup(target, backup, { library: true, preferences: false })).toThrow('supported')
  expect(target.length).toBe(1); expect(target.getItem('keep')).toBe('unchanged')
})

class TestWorker {
  onmessage?: (event: { data: unknown }) => void
  terminate() {}
  postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
}
const now = Date.UTC(2026, 9, 3, 12), hour = 3600000
const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
const entry = (id: string, label: string, start = now) => `<channel id="${id}"><display-name>${label}</display-name></channel><programme channel="${id}" start="${stamp(start)}" stop="${stamp(start + hour)}"><title>Schedule ${id}</title></programme>`
function fixture(xml: string) { vi.spyOn(Date, 'now').mockReturnValue(now); vi.stubGlobal('Worker', TestWorker); vi.stubGlobal('fetch', vi.fn(async () => new Response(`<tv>${xml}</tv>`))) }

it('uses unique normalized names and case-insensitive exact IDs, including past-only channels, through the actual XML worker', async () => {
  fixture(entry('news', 'Néws HD') + entry('duplicate-a', 'Sport') + entry('duplicate-b', 'Sport UHD') + entry('duplicate-c', 'Sport FHD') + entry('past', 'Earlier', now - 2 * 24 * hour))
  const guide = new XMLTVGuide('https://example.test/guide.xml'), signal = new AbortController().signal
  expect((await guide.load('wrong', 'News', signal))[0].title).toBe('Schedule news')
  expect((await guide.load('NEWS', 'Sport', signal))[0].title).toBe('Schedule news')
  expect(await guide.load(undefined, 'Sport', signal)).toEqual([])
  expect((await guide.load(undefined, 'Sport', signal, undefined, 'DUPLICATE-B'))[0].title).toBe('Schedule duplicate-b')
  expect(await guide.load('news', 'News', signal, undefined, 'removed-id')).toEqual([])
  expect((await guide.load('PAST', 'News', signal, { fromMs: now - 3 * 24 * hour, toMs: now }))[0].title).toBe('Schedule past')
  expect(await guide.choices('earlier', 0, signal)).toMatchObject({ total: 1, items: [{ id: 'past', name: 'Earlier' }] })
  expect(fetch).toHaveBeenCalledOnce(); guide.close()
})

it('searches names and IDs with bounded pages, clamps page requests, and cancels directory work', async () => {
  fixture(Array.from({ length: 45 }, (_, n) => entry(`id-${n}`, `Display ${n}`)).join(''))
  const guide = new XMLTVGuide('https://example.test/guide.xml'), signal = new AbortController().signal
  const first = await guide.choices('', 0, signal); expect(first).toMatchObject({ total: 45, pages: 3, page: 0 }); expect(first.items).toHaveLength(20)
  first.items[0].name = 'changed'; expect((await guide.choices('display 0', 0, signal)).items[0].name).toBe('Display 0')
  expect(await guide.choices('id-44', 99, signal)).toMatchObject({ total: 1, page: 0, pages: 1 })
  expect((await guide.choices('', 99, signal)).items).toHaveLength(5)
  expect(await guide.choices('absent', -1, signal)).toEqual({ total: 0, page: 0, pages: 0, items: [] })
  const controller = new AbortController(), pending = guide.choices('', 0, controller.signal); controller.abort()
  await expect(pending).rejects.toThrow('cancelled'); guide.close(); await expect(guide.choices('', 0, signal)).rejects.toThrow('cancelled')
})

it('invalidates pending guide results when a match changes, then restores automatic matching without a refetch', async () => {
  fixture(entry('a', 'First') + entry('b', 'Second'))
  let match: string | undefined
  const guide = new TVGuide(source, 'https://example.test/guide.xml', 0, () => match), signal = new AbortController().signal
  const live = { ...channel(), name: 'First', tvgId: 'a' }
  const pending = guide.load(live, signal); match = 'b'; guide.mappingChanged()
  await expect(pending).rejects.toThrow('cancelled')
  expect((await guide.load(live, signal))[0].title).toBe('Schedule b')
  match = undefined; guide.mappingChanged(); expect((await guide.load(live, signal))[0].title).toBe('Schedule a')
  expect(fetch).toHaveBeenCalledOnce(); guide.clear()
})

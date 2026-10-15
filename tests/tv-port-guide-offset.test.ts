// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { TVGuide, nowNext } from '../tv-app/guide'
import { parseCatalog, type Source } from '../tv-app/catalog'
import { guideOffset, channelGuideShift } from '../tv-app/guide-offset'
import { readProfiles, rememberProfile, saveGuideOffset, removeProfile } from '../tv-app/profiles'
import { MemoryStore, createBackup, validateBackup, restoreBackup } from '../tv-app/backup'
import { readSource } from '../tv-app/storage'
import { replayChannel } from '../tv-app/catchup'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'

const source: Source = { kind: 'xtream', url: 'https://provider.example', username: 'test', password: 'test' }
const channel = { name: 'News', group: '', url: 'https://provider.example/live.m3u8', mediaKind: 'live' as const, providerId: '1', tvgId: 'news', tvArchive: 1, tvArchiveDuration: 7 }
const signal = () => new AbortController().signal
const hour = 3600000, now = Date.UTC(2026, 9, 3, 0, 15)
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('validates source corrections independently from per-channel playlist shifts', () => {
  expect(guideOffset(undefined)).toBe(0); expect(guideOffset(-720)).toBe(-720); expect(guideOffset(840)).toBe(840)
  for (const value of [null, '60', NaN, Infinity, 31, -750, 870, true, {}]) expect(() => guideOffset(value)).toThrow()
  const channels = parseCatalog('#EXTM3U tvg-shift="1.5"\n#EXTINF:-1,Inherited\nhttps://example.com/1\n#EXTINF:-1 tvg-shift="-0.25",Quarter\nhttps://example.com/2\n#EXTINF:-1 tvg-shift="0",Unshifted\nhttps://example.com/3\n#EXTINF:-1 tvg-shift="999",Invalid\nhttps://example.com/4', 'https://example.com/list').channels
  expect(channels.map(item => item.tvgShift)).toEqual([1.5, -.25, 0, undefined])
  expect(channelGuideShift(-.25)).toBe(-15); expect(channelGuideShift(Infinity)).toBe(0)
})
it('shifts provider windows and now/next once, caches by channel shift, and rejects late results after a correction', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const row = { start_timestamp: (now - 75 * 60000) / 1000, stop_timestamp: (now - 15 * 60000) / 1000, title: 'Current news' }
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ epg_listings: [row] }))); vi.stubGlobal('fetch', fetcher)
  const guide = new TVGuide(source, undefined, 60), window = { fromMs: Date.UTC(2026, 9, 3), toMs: Date.UTC(2026, 9, 4) }
  const shifted = await guide.load(channel, signal(), false, window)
  expect(nowNext(shifted, now).current?.title).toBe('Current news'); expect(shifted[0].start).toBe(now - 15 * 60000); expect(shifted[0].guideShiftMinutes).toBe(60)
  expect((await guide.load(channel, signal(), false, window))[0].start).toBe(shifted[0].start); expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await guide.load({ ...channel, tvgShift: -.5 }, signal()))[0].start).toBe(now - 45 * 60000)
  let finish!: (response: Response) => void
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = guide.load(channel, signal(), true), rejected = expect(pending).rejects.toThrow('cancelled')
  guide.setOffset(0); finish(new Response(JSON.stringify({ epg_listings: [row] }))); await rejected
  const raw = await guide.load(channel, signal()); expect(raw[0].start).toBe(row.start_timestamp * 1000); expect(raw[0].guideShiftMinutes).toBeUndefined(); guide.clear()
})
it('reverses schedule correction before XMLTV window extraction, including midnight and day edges', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  class TestWorker { onmessage?: (event: { data: unknown }) => void; terminate() {}; postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) } }
  vi.stubGlobal('Worker', TestWorker)
  const stamp = (value: number) => new Date(value).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000'
  const start = Date.UTC(2026, 9, 2, 23), stop = Date.UTC(2026, 9, 3)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`<tv><channel id="news"><display-name>News</display-name></channel><programme channel="news" start="${stamp(start)}" stop="${stamp(stop)}"><title>Across midnight</title></programme></tv>`)))
  const guide = new TVGuide({ ...source, kind: 'playlist' }, 'https://example.com/guide.xml', 90)
  const rows = await guide.load({ ...channel, tvgShift: -.5 }, signal(), false, { fromMs: stop, toMs: stop + hour })
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ start: stop, stop: stop + hour, guideShiftMinutes: 60, title: 'Across midnight' })
  expect(nowNext(rows, now).current).toBe(rows[0]); guide.setOffset(0)
  expect(await guide.load(channel, signal(), false, { fromMs: stop, toMs: stop + hour })).toEqual([])
  expect(fetch).toHaveBeenCalledTimes(1); guide.clear()
})
it('retains source corrections in backups without changing identity, other profiles or the active source', () => {
  const storage = new MemoryStore(), other = { ...source, url: 'https://second.example/' }
  rememberProfile(storage, source, 'First', undefined, { guideOffset: 60 }); const id = readProfiles(storage)[0].id
  rememberProfile(storage, other, 'Second', undefined, { guideOffset: -90 })
  expect(saveGuideOffset(storage, source, 120)).toBe(true); expect(readSource(storage)).toEqual(other)
  const backup = createBackup(storage), target = new MemoryStore(); restoreBackup(target, backup, { library: true, preferences: false })
  expect(readProfiles(target)[0]).toMatchObject({ id, guideOffset: 120 }); expect(readProfiles(target)[1].guideOffset).toBe(-90)
  rememberProfile(target, source, 'Existing', undefined, { guideOffset: -60 }); restoreBackup(target, backup, { library: true, preferences: false }); expect(readProfiles(target)[0].guideOffset).toBe(-60)
  for (const invalid of ['60', null, 100000, 15]) expect(() => validateBackup({ ...backup, profiles: [{ ...backup.profiles[0], guideOffset: invalid }] })).toThrow()
  delete backup.profiles[0].guideOffset; expect(validateBackup(backup).profiles[0].guideOffset).toBeUndefined()
  removeProfile(storage, source); expect(saveGuideOffset(storage, source, 60)).toBe(false); expect(readProfiles(storage)).toHaveLength(1)
  const before = storage.getItem(storage.key(0)!)!; vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('quota') }); expect(() => saveGuideOffset(storage, other, 60)).toThrow('quota'); expect(storage.getItem(storage.key(0)!)).toBe(before)
})
it('uses original timestamps for both archive protocols and keeps catchup correction independent', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const programme = { start: now - hour * 3, stop: now - hour * 2, title: 'Earlier', description: '', archive: true }
  const corrected = { ...programme, start: programme.start + hour, stop: programme.stop + hour, guideShiftMinutes: 60 }
  const m3u = { ...channel, catchup: 'append', catchupSource: '?start={utc}&end={utcend}', catchupDays: 7, catchupCorrection: .5 }
  const playlist = { ...source, kind: 'playlist' as const }
  const a = await replayChannel(playlist, m3u, programme, signal()), b = await replayChannel(playlist, m3u, corrected, signal())
  expect(b.url).toBe(a.url); expect(new URL(b.url).searchParams.get('start')).toBe(String((programme.start - hour / 2) / 1000))
  const options = { format: 'hls' as const, offset: 120 }
  expect((await replayChannel(source, channel, corrected, signal(), options)).url).toBe((await replayChannel(source, channel, programme, signal(), options)).url)
})

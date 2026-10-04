// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { TVGuide, nowNext } from '../tv-app/guide'
import { handleWorkerRequest } from '../src/scripts/lib/epg-worker'
import { MemoryStore, createBackup, validateBackup, restoreBackup } from '../tv-app/backup'
import { readProfiles, rememberProfile, saveGuideOffset } from '../tv-app/profiles'
import { replayChannel } from '../tv-app/catchup'

const now = Date.UTC(2026, 9, 3, 12), minute = 60000
const source = { kind: 'playlist' as const, url: 'https://example.test/list.m3u', username: '', password: '' }
const channel = { name: 'News', group: 'News', url: 'https://example.test/stream', mediaKind: 'live' as const, tvgId: 'news', catchup: 'append', catchupSource: '?start={utc}&end={utcend}', catchupDays: 7 }
const signal = () => new AbortController().signal
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
function feed(explicit = '', shift = 120) {
  return `<tv><channel id="news"><display-name>News</display-name></channel>` + [-60, 0, 60].map(delta => `<programme channel="news" start="${stamp(now + (delta - shift - 5) * minute)}${explicit}" stop="${stamp(now + (delta - shift + 5) * minute)}${explicit}"><title>Show ${delta}</title></programme>`).join('') + '</tv>'
}
class TestWorker {
  onmessage?: (event: { data: unknown }) => void
  terminate() {}
  postMessage(value: any) { void Promise.resolve(handleWorkerRequest(value)).then(reply => { if (reply) this.onmessage?.({ data: reply }) }) }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function setup(xml = feed()) {
  vi.spyOn(Date, 'now').mockReturnValue(now); vi.stubGlobal('Worker', TestWorker)
  const fetcher = vi.fn(async () => new Response(xml)); vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it('estimates once per feed, reverses extraction windows, preserves archive timestamps and keeps manual control', async () => {
  const fetcher = setup(), guide = new TVGuide(source, 'https://example.test/guide.xml', 'auto')
  // Three isolated programmes also fit +60; nearest-zero winning coverage is +60.
  const rows = await guide.load(channel, signal(), false, { fromMs: now - minute, toMs: now + minute })
  expect(guide.automaticCorrection).toEqual({ minutes: 60, channels: 1, reason: 'estimated' })
  expect(nowNext(rows, now).current?.title).toBe('Show 60'); expect(rows[0].guideShiftMinutes).toBe(60)
  const raw = { ...rows[0], start: rows[0].start - 60 * minute, stop: rows[0].stop - 60 * minute, guideShiftMinutes: 0 }
  const earlier = { ...rows[0], start: rows[0].start - 60 * minute, stop: rows[0].stop - 60 * minute }
  const originalEarlier = { ...raw, start: raw.start - 60 * minute, stop: raw.stop - 60 * minute }
  expect((await replayChannel(source, channel, earlier, signal())).url).toBe((await replayChannel(source, channel, originalEarlier, signal())).url)
  await guide.load(channel, signal()); expect(fetcher).toHaveBeenCalledTimes(1)
  guide.setOffset(0); expect(nowNext(await guide.load(channel, signal()), now).current).toBeUndefined()
  guide.setOffset(120); expect(nowNext(await guide.load(channel, signal()), now).current?.title).toBe('Show 0')
  guide.clear()
})

it('keeps explicit feeds unshifted automatically, retains channel shifts, and reports refreshed evidence', async () => {
  const fetcher = setup(feed(' +0000', 0)), guide = new TVGuide(source, 'https://example.test/guide.xml', 'auto')
  expect(nowNext(await guide.load(channel, signal()), now).current?.title).toBe('Show 0')
  expect(guide.automaticCorrection?.reason).toBe('explicit')
  expect((await guide.load({ ...channel, tvgShift: 1 }, signal()))[0].guideShiftMinutes).toBe(60)
  fetcher.mockImplementation(async () => new Response(feed('', 180)))
  await guide.load(channel, signal(), true); expect(guide.automaticCorrection?.reason).toBe('estimated'); expect(fetcher).toHaveBeenCalledTimes(2)
  guide.clear()
})

it('rejects stale inference when a manual setting changes during download', async () => {
  const fetcher = setup(); let complete!: (value: Response) => void
  fetcher.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const guide = new TVGuide(source, 'https://example.test/guide.xml', 'auto'), pending = guide.load(channel, signal())
  const rejected = expect(pending).rejects.toThrow('cancelled')
  guide.setOffset(30); complete(new Response(feed())); await rejected
  expect(guide.automaticCorrection).toBeUndefined(); guide.clear()
})

it('saves Automatic per remembered source and round-trips backups without serializing an estimated offset', () => {
  const storage = new MemoryStore(); rememberProfile(storage, source, 'Guide', undefined, { guideOffset: 'auto' })
  expect(readProfiles(storage)[0].guideOffset).toBe('auto')
  const backup = createBackup(storage), target = new MemoryStore(); restoreBackup(target, validateBackup(backup), { library: true, preferences: true })
  expect(readProfiles(target)[0].guideOffset).toBe('auto'); expect(saveGuideOffset(target, source, 0)).toBe(true); expect(readProfiles(target)[0].guideOffset).toBeUndefined()
  for (const invalid of ['AUTO', 'automatic', '120', -721]) expect(() => validateBackup({ ...backup, profiles: [{ ...backup.profiles[0], guideOffset: invalid }] })).toThrow()
})

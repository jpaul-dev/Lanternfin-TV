// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DOWNLOAD_FILE_LIMIT, TVDownloads, downloadProblem, localDownload } from '../tv-app/downloads'
import { samsungPlayer } from '../tv-app/player'
import type { Channel } from '../tv-app/catalog'
import { downloadDevice } from './helpers/tv-downloads'

const movie: Channel = { name: 'A movie', group: 'Movies', mediaKind: 'movie', url: 'https://example.test/private/movie.mp4?token=secret', playback: { headers: { authorization: 'Bearer secret', cookie: 'secret' } } }
beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('requires explicit compatible finite media and never strips protection or special headers', () => {
  expect(downloadProblem(movie)).toBeUndefined()
  for (const value of [ { ...movie, mediaKind: 'live' }, { ...movie, url: 'file:///private/movie.mp4' }, { ...movie, url: 'https://a.test/movie.m3u8' }, { ...movie, playback: { drm: { system: 'org.w3.clearkey' } } }, { ...movie, playback: { manifestType: 'hls' } }, { ...movie, playback: { headers: { host: 'other.test' } } }, { ...movie, playback: { headers: { x: 'a\nb' } } } ]) expect(downloadProblem(value as Channel)).toBeTruthy()
})

it('sends headers to the native service but persists only safe metadata, generated private names and progress', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie)
  const request = device.requests.get(1)!
  expect(request.httpHeader).toEqual(movie.playback!.headers)
  expect(request.destination).toBe('wgt-private/lanternfin-downloads')
  expect(request.fileName).toMatch(/^[a-f\d]{32}\.mp4$/)
  expect(localStorage.getItem('lanternfin.downloads.v1')).not.toMatch(/secret|https:|authorization|cookie/)
  device.listeners.get(1)!.onprogress(1, 123, 123456)
  device.complete(1)
  const item = downloads.list()[0], channel = downloads.channel(item.key)
  expect(localDownload(channel)).toMatch(/^file:\/\//)
  expect(localDownload({ ...channel })).toBeUndefined()
  downloads.progress(channel, 42, 300)
  expect(downloads.list()[0].position).toBe(42)
  downloads.progress(channel, 299, 300, true)
  expect(downloads.list()[0].position).toBe(0)
  expect(device.api.filesystem.toURI).not.toHaveBeenCalledWith('/do/not/trust/this/path.mp4')
})

it('allows only verified download objects through AVPlay local-file access', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie); device.complete(1)
  const channel = downloads.channel(downloads.list()[0].key)
  const api = { close: vi.fn(), open: vi.fn(), getState: () => 'NONE', setDisplayRect: vi.fn(), setDisplayMethod: vi.fn(), setListener: vi.fn(), prepareAsync: vi.fn() }
  const report = vi.fn(), player = samsungPlayer(api as any, report)
  player.play({ ...channel }); expect(api.open).not.toHaveBeenCalled()
  player.play(channel); expect(api.open).toHaveBeenCalledWith(channel.url)
  player.stop(); api.open.mockClear(); channel.url = 'file:///etc/other-file'; player.play(channel)
  expect(api.open).not.toHaveBeenCalled()
})

it('pauses background transfers without auto-resume and restores owned transfers paused', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie); const key = downloads.list()[0].key
  downloads.suspend(); expect(downloads.list()[0].state).toBe('paused')
  expect(() => downloads.resume(key)).toThrow()
  downloads.foreground(); expect(device.api.download.resume).not.toHaveBeenCalled()
  downloads.resume(key); expect(downloads.list()[0].state).toBe('downloading')
  const restored = new TVDownloads(device.api); restored.load()
  expect(restored.list()[0].state).toBe('paused')
  restored.resume(key); expect(restored.list()[0].state).toBe('downloading')
})

it('does not touch a reused native transfer ID belonging to a different destination', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie)
  device.requests.get(1)!.destination = 'downloads/unrelated'
  const restored = new TVDownloads(device.api); restored.load()
  expect(restored.list()[0].state).toBe('failed')
  expect(device.api.download.pause).not.toHaveBeenCalled()
  expect(device.api.download.cancel).not.toHaveBeenCalled()
})

it('cancels oversized transfers, ignores late completion and removes only the generated file after cancellation', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie)
  const item = downloads.list()[0], listener = device.listeners.get(1)!
  listener.onprogress(1, 1000, DOWNLOAD_FILE_LIMIT + 1)
  expect(downloads.list()[0].state).toBe('canceling')
  await expect(downloads.remove(item.key)).rejects.toThrow('Cancel')
  await Promise.resolve(); expect(downloads.list()[0].state).toBe('failed')
  device.files.set(`wgt-private/lanternfin-downloads/${item.file}`, 1000)
  listener.oncompleted(1, 'documents/family.mp4')
  expect(downloads.list()[0].state).toBe('failed')
  await downloads.remove(item.key)
  expect(device.api.filesystem.deleteFile).toHaveBeenCalledWith(`wgt-private/lanternfin-downloads/${item.file}`, expect.any(Function), expect.any(Function))
  listener.onprogress(1, 1, 10); expect(downloads.list()).toHaveLength(0)
})

it('reserves capacity for incomplete transfers and permits only one active transfer', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie)
  await expect(downloads.start(movie)).rejects.toThrow('Pause')
  downloads.pause(downloads.list()[0].key); await downloads.start(movie)
  downloads.pause(downloads.list()[1].key)
  await expect(downloads.start(movie)).rejects.toThrow('space')
})

it('rejects corrupt and oversized metadata without following any stored path', () => {
  const device = downloadDevice()
  localStorage.setItem('lanternfin.downloads.v1', JSON.stringify([{ key: 'a'.repeat(32), file: '../../other.mp4' }]))
  const downloads = new TVDownloads(device.api); downloads.load()
  expect(downloads.list()).toEqual([]); expect(downloads.message).toContain('could not be read')
  expect(device.api.filesystem.openFile).not.toHaveBeenCalled()
  expect(device.api.download.getState).not.toHaveBeenCalled()
})

it('stops a native transfer if saving its ID fails and never leaks raw errors', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  const original = Storage.prototype.setItem
  let calls = 0
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (++calls > 1) throw new Error('provider secret'); return original.call(this, key, value) })
  await expect(downloads.start(movie)).rejects.toThrow('Download unavailable')
  expect(device.api.download.cancel).toHaveBeenCalledWith(1)
  expect(downloads.message).not.toContain('secret')
  expect(downloads.list()[0].note).not.toContain('secret')
})

it('does not use shared storage when private storage is unsupported and handles negative native IDs', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  vi.mocked(device.api.filesystem.createDirectory).mockImplementation(() => { throw new Error('private-path secret') })
  await expect(downloads.start(movie)).rejects.toThrow('Download unavailable')
  expect(device.api.download.start).not.toHaveBeenCalled()
  vi.mocked(device.api.filesystem.createDirectory).mockImplementation((_, __, ok) => ok())
  vi.mocked(device.api.filesystem.isDirectory).mockReturnValue(true)
  vi.mocked(device.api.download.start).mockReturnValue(-1)
  await expect(downloads.start(movie)).rejects.toThrow('Download unavailable')
  expect(downloads.list()[0].state).toBe('failed')
  expect(device.api.download.cancel).not.toHaveBeenCalled()
})

it('does not start after storage setup completes while backgrounded, and bounds a missing callback', async () => {
  vi.useFakeTimers()
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  let done: (() => void) | undefined
  vi.mocked(device.api.filesystem.createDirectory).mockImplementation((_, __, ok) => { done = ok })
  const pending = downloads.start(movie); const assertion = expect(pending).rejects.toThrow()
  downloads.suspend(); done!(); await assertion
  expect(device.api.download.start).not.toHaveBeenCalled()
  downloads.foreground()
  const timeout = expect(downloads.start(movie)).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(12000); await timeout
})

it('checks completed file existence and size again before playback', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie); device.complete(1)
  const item = downloads.list()[0]
  device.files.set(`wgt-private/lanternfin-downloads/${item.file}`, 12)
  expect(() => downloads.channel(item.key)).toThrow('unavailable')
})

it('keeps uncertain native transfers protected from removal and ignores a stale pause callback after resume', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie); const item = downloads.list()[0]
  downloads.pause(item.key); downloads.resume(item.key)
  device.listeners.get(1)!.onpaused(1)
  expect(downloads.list()[0].state).toBe('downloading')
  vi.mocked(device.api.download.getDownloadRequest).mockImplementation(() => { throw new Error('temporary service failure with secret') })
  downloads.refresh(); expect(downloads.list()[0].state).toBe('downloading')
  await expect(downloads.remove(item.key)).rejects.toThrow('Cancel')
  expect(device.api.filesystem.deleteFile).not.toHaveBeenCalled()
  expect(downloads.list()[0].note).not.toContain('secret')
})

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TVDownloads } from '../tv-app/downloads'
import { downloadDevice } from './helpers/tv-downloads'

const movie = { name: 'Movie', url: 'https://example.test/movie.mp4', mediaKind: 'movie' as const, group: 'Movies' }
beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('confirms native cancellation before removing partial files and drops only the download manifest', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api)
  await downloads.start(movie)
  const request = device.requests.get(1)!, file = `${request.destination}/${request.fileName}`; device.files.set(file, 123)
  localStorage.setItem('other', 'keep')
  vi.spyOn(device.api.filesystem, 'deleteFile').mockImplementation((path, done) => { expect(device.states.get(1)).toBe('CANCELED'); device.files.delete(path); done() })
  await downloads.removeAll()
  expect(device.api.download.cancel).toHaveBeenCalledWith(1); expect(device.files.size).toBe(0); expect(downloads.list()).toEqual([])
  expect(localStorage.getItem('lanternfin.downloads.v1')).toBeNull(); expect(localStorage.getItem('other')).toBe('keep')
  device.listeners.get(1)!.onprogress(1, 999, 999); device.listeners.get(1)!.oncompleted(1, file)
  expect(downloads.list()).toEqual([]); expect(localStorage.getItem('lanternfin.downloads.v1')).toBeNull()
})

it('retains files and metadata when the TV does not acknowledge cancellation', async () => {
  vi.useFakeTimers()
  const device = downloadDevice(), downloads = new TVDownloads(device.api); await downloads.start(movie)
  vi.mocked(device.api.download.cancel).mockImplementation(() => {})
  const result = expect(downloads.removeAll()).rejects.toThrow('could not confirm')
  await vi.advanceTimersByTimeAsync(12100); await result
  expect(device.api.filesystem.deleteFile).not.toHaveBeenCalled(); expect(downloads.list()).toHaveLength(1)
  expect(localStorage.getItem('lanternfin.downloads.v1')).toBeTruthy()
})

it('handles completed files and a transfer ID reused by a different destination without canceling it', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api); await downloads.start(movie); device.complete(1)
  await downloads.start(movie); const request = device.requests.get(2)!; device.files.set(`${request.destination}/${request.fileName}`, 50)
  device.requests.set(2, { ...request, destination: 'other-app-folder' })
  await downloads.removeAll()
  expect(device.api.download.cancel).not.toHaveBeenCalled(); expect(device.files.size).toBe(0); expect(downloads.list()).toEqual([])
})

it('keeps metadata and allows retry when file removal fails', async () => {
  const device = downloadDevice(), downloads = new TVDownloads(device.api); await downloads.start(movie); device.complete(1)
  vi.mocked(device.api.filesystem.deleteFile).mockImplementationOnce((_, __, fail) => fail())
  await expect(downloads.removeAll()).rejects.toThrow('could not be removed')
  expect(downloads.list()).toHaveLength(1); expect(device.files.size).toBe(1)
  await downloads.removeAll(); expect(device.files.size).toBe(0); expect(localStorage.getItem('lanternfin.downloads.v1')).toBeNull()
})

it('refuses corrupt or inaccessible native metadata instead of losing references to saved files', async () => {
  localStorage.setItem('lanternfin.downloads.v1', '{corrupt')
  const device = downloadDevice(); await expect(new TVDownloads(device.api).removeAll()).rejects.toThrow('could not be read')
  await expect(new TVDownloads().removeAll()).rejects.toThrow('cannot remove')
  expect(device.api.filesystem.deleteFile).not.toHaveBeenCalled(); expect(localStorage.getItem('lanternfin.downloads.v1')).toBe('{corrupt')
  localStorage.setItem('lanternfin.downloads.v1', '[]'); await new TVDownloads().removeAll(); expect(localStorage.getItem('lanternfin.downloads.v1')).toBeNull()
})

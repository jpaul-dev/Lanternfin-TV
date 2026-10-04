// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { providerRuntime, runtimeLabel } from '../tv-app/provider-runtime'
import { episodeRow, cardChannel } from '../tv-app/presentation'
import { TVLibrary } from '../tv-app/library'
import { MemoryStore } from '../tv-app/backup'
import { mediaUrl } from '../tv-app/xtream'

it('normalizes finite provider runtimes and rejects malformed or excessive values', () => {
  expect(providerRuntime('2700.5')).toBe(2700); expect(runtimeLabel(providerRuntime(null, '00:45:30'))).toBe('45:30')
  expect(runtimeLabel(providerRuntime(-1, '1:03:02'))).toBe('1:03:02'); expect(providerRuntime(undefined, '43:10')).toBe(2590)
  for (const value of [0, -1, NaN, Infinity, true, {}, [], 604801, '1e3', '  1e8 ', '<script>']) expect(providerRuntime(value)).toBeUndefined()
  for (const value of ['24', '1:60:00', '1:00:60', '-1:05', '999:59:59', '00:00']) expect(providerRuntime(null, value)).toBeUndefined()
  expect(providerRuntime(null, '168:00:00')).toBe(604800); expect(runtimeLabel(undefined)).toBe('')
})
it('keeps row actions, inert descriptions, watched marks, progress and runtime without using metadata for resume', () => {
  const source = { kind: 'xtream' as const, url: 'https://example.com', username: 'test', password: 'test' }
  const episode = { name: 'S1 E1 · Opening', group: 'Season 1', mediaKind: 'episode' as const, providerId: '2', seriesId: '1', durationSeconds: 2700, description: '<img src=x onerror=bad()>', url: mediaUrl(source, 'series', '2', 'mp4') }
  const storage = new MemoryStore(), library = new TVLibrary(storage, source), action = vi.fn()
  library.record(episode, 120, 3000)
  const row = episodeRow(episode, action, library)
  expect(cardChannel(row)).toBe(episode); expect(row.classList.contains('episode-row')).toBe(true)
  expect(row.textContent).toContain('45:00'); expect(row.textContent).toContain('Continue from 2:00'); expect(row.querySelector('img')).toBeNull()
  expect(row.querySelector('progress')?.max).toBe(3000); row.click(); expect(action).toHaveBeenCalledOnce()
  library.markWatched(episode, true); expect(episodeRow(episode, action, library).textContent).toContain('Watched')
  const restored = new TVLibrary(storage, source); expect(restored.bookmarkedChannels()[0].durationSeconds).toBe(2700)
  const stored = storage.getItem(storage.key(0)!)!; expect(stored).not.toContain('onerror'); expect(stored).not.toContain('https:')
})

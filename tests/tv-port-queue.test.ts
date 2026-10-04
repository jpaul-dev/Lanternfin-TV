import { expect, it } from 'vitest'
import { LiveQueue, nextEpisode } from '../tv-app/playback-queue'
import type { Channel } from '../tv-app/catalog'
const live = (id: number): Channel => ({ name: String(id), group: 'Live', url: `https://example.com/${id}.m3u8`, mediaKind: 'live' })
it('keeps a stable live-only queue and wraps without choosing VOD', () => {
  const queue = new LiveQueue(), a = live(1), b = live(2)
  queue.reset([a, { ...live(3), mediaKind: 'movie' }, b, a], a)
  expect(queue.length).toBe(2); expect(queue.step(-1)).toBe(b); expect(queue.step(1)).toBe(a)
  expect(queue.tune('000002')).toBe(b); expect(queue.number).toBe(2)
  for (const digits of ['0', '3', '1.5', '-1', '1000000']) expect(queue.tune(digits)).toBeUndefined()
  expect(queue.number).toBe(2)
})
it('never auto-selects an unrelated episode when playback lacks series context', () => {
  const a: Channel = { ...live(1), mediaKind: 'episode' }, b: Channel = { ...live(2), mediaKind: 'episode' }
  expect(nextEpisode([a, b], a)).toBe(b); expect(nextEpisode([a, b], b)).toBeUndefined()
  expect(nextEpisode([a, b], { ...a, url: 'https://example.com/else.mp4' })).toBeUndefined()
})

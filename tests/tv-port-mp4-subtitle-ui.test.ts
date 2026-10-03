// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { mp4SubtitleUI } from '../tv-app/mp4-subtitle-ui'
import { SubtitleError, SubtitleTimeline } from '../tv-app/external-subtitles'
import type { openMp4Subtitles, Mp4SubtitleSession } from '../tv-app/mp4-subtitles'

afterEach(() => vi.useRealTimers())
const windowAt = (position: number) => ({ from: Math.max(0, position - 5), to: position + 45, timeline: new SubtitleTimeline([{ start: position, end: position + 45, text: String(position) }]) })
function setup(read: Mp4SubtitleSession['read'], opener?: typeof openMp4Subtitles) {
  vi.useFakeTimers(); document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const root = document.getElementById('track-menu')!, note = () => document.getElementById('mp4-status')!.textContent
  let position = 0, active: string | undefined
  const accept = vi.fn((id: string) => { active = id; return true })
  const session = { tracks: [{ id: 1, language: 'eng', samples: [] }, { id: 2, language: 'fra', samples: [] }], read }
  const ui = mp4SubtitleUI(root, { media: () => ({ url: 'https://video.example/movie.mp4' }), allowed: () => true, position: () => position, activeId: () => active, nativeTracks: () => false, accept, changed: vi.fn() }, opener || vi.fn(async () => session))
  return { ui, accept, note, setPosition: (value: number) => { position = value } }
}

it('discards a stale read after a seek and keeps active prefetch running when the menu closes', async () => {
  const pending: { position: number; signal: AbortSignal; resolve: (value: ReturnType<typeof windowAt>) => void }[] = []
  const read = vi.fn((_id: number, position: number, signal: AbortSignal) => pending.length || position ? new Promise<ReturnType<typeof windowAt>>(resolve => pending.push({ position, signal, resolve })) : Promise.resolve(windowAt(position)))
  const { ui, accept, setPosition } = setup(read)
  ui.open(); await vi.advanceTimersByTimeAsync(0); ui.select('mp4-text-1'); await vi.advanceTimersByTimeAsync(0)
  expect(accept).toHaveBeenCalledTimes(1)
  setPosition(31); await vi.advanceTimersByTimeAsync(1000); ui.close(); expect(pending[0].signal.aborted).toBe(false)
  setPosition(200); await vi.advanceTimersByTimeAsync(1000); expect(pending[0].signal.aborted).toBe(true)
  pending[0].resolve(windowAt(31)); await vi.advanceTimersByTimeAsync(0); expect(accept).toHaveBeenCalledTimes(1)
  pending[1].resolve(windowAt(200)); await vi.advanceTimersByTimeAsync(0)
  expect(accept).toHaveBeenLastCalledWith('mp4-text-1', expect.any(SubtitleTimeline), true)
  ui.deactivate(); expect(vi.getTimerCount()).toBe(0)
})

it('surfaces a read-ahead failure with manual Retry and cancels discovery on reset', async () => {
  const read = vi.fn(async (_id: number, position: number) => windowAt(position))
  const { ui, note, setPosition, accept } = setup(read)
  ui.open(); await vi.advanceTimersByTimeAsync(0); ui.select('mp4-text-1'); await vi.advanceTimersByTimeAsync(0)
  read.mockRejectedValueOnce(new SubtitleError('The video server must support byte-range reads.'))
  setPosition(31); await vi.advanceTimersByTimeAsync(1000)
  expect(note()).toContain('byte-range'); expect(document.getElementById('mp4-retry')!.hidden).toBe(false)
  document.getElementById('mp4-retry')!.click(); await vi.advanceTimersByTimeAsync(0); expect(accept).toHaveBeenCalledTimes(2)
  ui.reset(); expect(vi.getTimerCount()).toBe(0)
  let finish: ((session: Mp4SubtitleSession) => void) | undefined, signal: AbortSignal | undefined
  const opener = vi.fn((_media, incoming: AbortSignal) => { signal = incoming; return new Promise<Mp4SubtitleSession>(resolve => { finish = resolve }) })
  const next = setup(read, opener); next.ui.open(); next.ui.reset(); expect(signal?.aborted).toBe(true)
  finish!({ tracks: [{ id: 1, language: 'eng', samples: [] }], read }); await vi.advanceTimersByTimeAsync(0)
  expect(next.ui.tracks()).toEqual([]); expect(next.accept).not.toHaveBeenCalled()
})

it('keeps the previous track reading ahead after a pending replacement is closed', async () => {
  let replacementSignal: AbortSignal | undefined
  const read = vi.fn((id: number, position: number, signal: AbortSignal) => {
    if (id === 2) { replacementSignal = signal; return new Promise<ReturnType<typeof windowAt>>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))) }
    return Promise.resolve(windowAt(position))
  })
  const { ui, setPosition, accept } = setup(read)
  ui.open(); await vi.advanceTimersByTimeAsync(0); ui.select('mp4-text-1'); await vi.advanceTimersByTimeAsync(0)
  ui.select('mp4-text-2'); ui.close(); expect(replacementSignal?.aborted).toBe(true)
  setPosition(31); await vi.advanceTimersByTimeAsync(1000)
  expect(accept).toHaveBeenCalledTimes(2); expect(accept).toHaveBeenLastCalledWith('mp4-text-1', expect.any(SubtitleTimeline), true)
  ui.reset(); expect(vi.getTimerCount()).toBe(0)
})

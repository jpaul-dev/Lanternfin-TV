// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { subtitleUI } from '../tv-app/subtitle-ui'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it('requires a finite video and successful caption muting, and ignores a cancelled late response', async () => {
  vi.useFakeTimers()
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  let allowed = true, complete: ((value: Response) => void) | undefined
  const silence = vi.fn(() => false), changed = vi.fn()
  const ui = subtitleUI(el('track-menu'), el('external-subtitles'), { allowed: () => allowed, position: () => 1, controlsHeight: () => 0, silence, changed })
  const srt = '00:00.000 --> 00:05.000\nTest caption'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(srt)))
  el('subtitle-add').click(); el<HTMLInputElement>('subtitle-url').value = 'https://captions.example/subtitle.vtt'; el('subtitle-load').click()
  await vi.advanceTimersByTimeAsync(0)
  expect(el('subtitle-load-status').textContent).toContain('could not be turned off')
  expect(ui.loaded).toBe(false); expect(ui.active).toBe(false); expect(changed).not.toHaveBeenCalled()
  silence.mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
  el('subtitle-load').click(); ui.close(); complete!(new Response(srt)); await vi.advanceTimersByTimeAsync(0)
  expect(ui.loaded).toBe(false); expect(silence).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled()
  allowed = false; ui.refresh(); expect(el<HTMLButtonElement>('subtitle-add').disabled).toBe(true)
  ui.reset(); expect(vi.getTimerCount()).toBe(0)
})

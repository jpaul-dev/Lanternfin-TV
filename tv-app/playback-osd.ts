import type { State } from './player'
import { durationLabel } from './library'
import { tr } from './i18n'

export type Timeline = { position: number; duration: number }
export function canSeek(timeline: Timeline | undefined, live: boolean, state: State): timeline is Timeline {
  return !!timeline && !live && ['playing', 'paused'].includes(state) && Number.isFinite(timeline.position) && Number.isFinite(timeline.duration) && timeline.duration > 1
}

/** A readout of the player's actual timeline, never a promised native seek result. */
export function scrubOSD(root: HTMLElement) {
  const position = root.querySelector<HTMLElement>('[data-scrub-position]')!
  const remaining = root.querySelector<HTMLElement>('[data-scrub-remaining]')!
  const delta = root.querySelector<HTMLElement>('[data-scrub-delta]')!
  const progress = root.querySelector<HTMLProgressElement>('progress')!
  let timer: ReturnType<typeof setTimeout> | undefined
  const hide = () => { clearTimeout(timer); root.hidden = true }
  const update = (timeline: Timeline) => {
    if (!Number.isFinite(timeline.position) || !Number.isFinite(timeline.duration) || timeline.duration <= 1) { hide(); return }
    const seconds = Math.max(0, Math.min(timeline.position, timeline.duration))
    position.textContent = durationLabel(seconds)
    remaining.textContent = tr('{time} remaining', { time: durationLabel(timeline.duration - seconds) })
    progress.max = timeline.duration; progress.value = seconds
  }
  return {
    hide, update,
    show(timeline: Timeline, seconds: number) {
      clearTimeout(timer); root.hidden = false; update(timeline)
      delta.textContent = `${seconds < 0 ? '−' : '+'}${Math.abs(seconds)}s`
      timer = setTimeout(hide, 3000)
    },
  }
}

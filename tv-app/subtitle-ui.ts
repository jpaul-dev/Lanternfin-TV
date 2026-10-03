import { loadSubtitles, SubtitleError, type SubtitleTimeline } from './external-subtitles'
import type { SubtitlePresentation } from './player'
import { tr } from './i18n'

export const EXTERNAL_SUBTITLE = 'external-file'
export function subtitleUI(root: HTMLElement, overlay: HTMLElement, options: {
  allowed(): boolean; position(): number; controlsHeight(): number; silence(): boolean; changed(): void
}) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const url = el<HTMLInputElement>('subtitle-url'), file = el<HTMLInputElement>('subtitle-file')
  const method = el<HTMLSelectElement>('subtitle-method'), open = el<HTMLButtonElement>('subtitle-add')
  const load = el<HTMLButtonElement>('subtitle-load'), editor = el('subtitle-editor'), status = el('subtitle-load-status')
  let timeline: SubtitleTimeline | undefined, active = false, presentation = { delay: 0, scale: 1 }
  let loadedId = EXTERNAL_SUBTITLE
  let loading: AbortController | undefined, interval: ReturnType<typeof setInterval> | undefined
  const render = () => {
    const text = active && options.allowed() ? timeline?.at(options.position() - presentation.delay) || '' : ''
    if (overlay.textContent !== text) overlay.textContent = text
    overlay.hidden = !text
    overlay.style.fontSize = `${4 * presentation.scale}vh`
    const bottom = Math.min(options.controlsHeight(), window.innerHeight * .7)
    overlay.style.bottom = bottom ? `${bottom + window.innerHeight * .01}px` : '6vh'
    overlay.style.maxHeight = bottom ? `${Math.max(0, window.innerHeight * .94 - bottom)}px` : '60vh'
    const left = window.innerWidth * (root.hidden ? .12 : .03)
    const right = root.hidden ? left : window.innerWidth - root.getBoundingClientRect().left + window.innerWidth * .02
    overlay.style.left = `${left}px`; overlay.style.right = `${right}px`
    overlay.style.maxWidth = `${Math.max(0, window.innerWidth - left - right)}px`
  }
  const mode = () => {
    el('subtitle-url-field').hidden = method.value !== 'url'; el('subtitle-file-field').hidden = method.value !== 'file'
    url.value = ''; file.value = ''; status.textContent = ''
  }
  const close = () => {
    loading?.abort(); loading = undefined; editor.hidden = true; open.setAttribute('aria-expanded', 'false')
    url.value = ''; file.value = ''; status.textContent = ''; load.disabled = false; method.disabled = false
  }
  open.onclick = () => {
    if (!editor.hidden) { close(); return }
    editor.hidden = false; open.setAttribute('aria-expanded', 'true'); method.value = 'url'; mode(); url.focus()
  }
  method.onchange = mode
  el('subtitle-cancel').onclick = () => { close(); open.focus() }
  load.onclick = async () => {
    if (loading) return
    if (!options.allowed()) { status.textContent = tr('Resume playback before loading subtitles for this video.'); return }
    const source = method.value === 'file' ? file.files?.[0] : url.value.trim()
    if (!source) { status.textContent = tr('Choose a subtitle file or enter its URL.'); return }
    const pending = new AbortController(); loading = pending; load.disabled = true; method.disabled = true
    status.textContent = tr('Loading subtitles…')
    try {
      const loaded = await loadSubtitles(source, pending.signal)
      if (pending.signal.aborted || loading !== pending) return
      if (!options.allowed()) throw new SubtitleError('Resume playback before loading subtitles for this video.')
      if (!options.silence()) throw new SubtitleError('The current captions could not be turned off. Resume playback and try again.')
      timeline = loaded; active = true; loadedId = EXTERNAL_SUBTITLE; presentation = { delay: 0, scale: 1 }
      clearInterval(interval); interval = setInterval(render, 250); render()
      close(); options.changed(); el('track-status').textContent = tr('External subtitles loaded for this video. Size and timing can be adjusted below.')
      el('subtitle-track').focus()
    } catch (error) {
      if (!pending.signal.aborted && loading === pending) status.textContent = tr(error instanceof SubtitleError ? error.message : 'The subtitle file could not be read.')
    } finally {
      if (loading === pending) { loading = undefined; load.disabled = false; method.disabled = false }
    }
  }
  return {
    get loaded() { return !!timeline && loadedId === EXTERNAL_SUBTITLE }, get active() { return active },
    get activeId() { return active ? loadedId : undefined },
    embedded(id: string, next: SubtitleTimeline, update = false) {
      if (update ? !active || loadedId !== id : !options.allowed() || !options.silence()) return false
      timeline = next; loadedId = id; active = true
      if (!update) presentation = { delay: 0, scale: 1 }
      clearInterval(interval); interval = setInterval(render, 250); render(); return true
    },
    presentation(): SubtitlePresentation | undefined { return active ? { ...presentation } : undefined },
    setPresentation(value: SubtitlePresentation) {
      if (!active || !Number.isFinite(value.delay) || Math.abs(value.delay) > 5 || ![.75, 1, 1.25, 1.5, 2].includes(value.scale)) return false
      presentation = { ...value }; render(); return true
    },
    select() { if (!timeline || loadedId !== EXTERNAL_SUBTITLE || !options.allowed() || !options.silence()) return false; active = true; render(); return true },
    deselect() { active = false; render() },
    refresh() { open.disabled = !options.allowed(); render() },
    back() { if (editor.hidden) return false; close(); open.focus(); return true },
    close,
    reset() { close(); timeline = undefined; active = false; presentation = { delay: 0, scale: 1 }; clearInterval(interval); interval = undefined; render() },
  }
}

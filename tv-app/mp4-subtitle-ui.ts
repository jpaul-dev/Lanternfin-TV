import { embeddedSubtitleProblem, openEmbeddedSubtitles, embeddedFormat, type EmbeddedSubtitleSession } from './embedded-subtitles'
import { SubtitleError, type SubtitleTimeline } from './external-subtitles'
import { languageName, type PlayerTrack } from './player'
import type { Media } from './media'
import { tr } from './i18n'
import { languageScore } from './preferences'

export const MP4_SUBTITLE = 'mp4-text-', MKV_SUBTITLE = 'mkv-text-'
export function mp4SubtitleUI(root: HTMLElement, options: {
  media(): Media | undefined; allowed(): boolean; position(): number; activeId(): string | undefined; nativeTracks(): boolean
  accept(id: string, timeline: SubtitleTimeline, update: boolean): boolean; changed(): void
  preferredLanguage?(): string | undefined
}, openSession = openEmbeddedSubtitles) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const scanButton = el<HTMLButtonElement>('mp4-scan'), cancelButton = el<HTMLButtonElement>('mp4-cancel'), retry = el<HTMLButtonElement>('mp4-retry'), note = el('mp4-status')
  let session: EmbeddedSubtitleSession | undefined, attempted = false, active: number | undefined, failed = false
  let retryTrack: number | undefined
  let job: { controller: AbortController; kind: 'scan' | 'select' | 'prefetch'; from: number; to: number; automatic?: string } | undefined
  let automaticAttempted = false
  let interval: ReturnType<typeof setInterval> | undefined, coverage = { from: 0, to: 0 }
  const prefix = () => embeddedFormat(options.media()) === 'MKV' ? MKV_SUBTITLE : MP4_SUBTITLE
  const message = (text: string) => tr(text.replace(/MP4/g, embeddedFormat(options.media())))
  const busy = () => !!job
  const render = () => {
    const media = options.media(), problem = embeddedSubtitleProblem(media)
    el('mp4-subtitle-tools').hidden = !media || media.mediaKind === 'live' || !/^https?:\/\/.*\.(?:mp4|m4v|mov|mkv)(?:[?#]|$)/i.test(media.url)
    scanButton.hidden = !!session?.tracks.length
    scanButton.disabled = !!problem || !!job || !options.allowed()
    if (problem && !el('mp4-subtitle-tools').hidden) note.textContent = tr(problem)
    scanButton.textContent = message(attempted ? 'Scan MP4 subtitles again' : 'Find embedded MP4 subtitles')
    cancelButton.hidden = !job; retry.hidden = !failed || retryTrack === undefined
  }
  const cancel = (message = '') => { job?.controller.abort(); job = undefined; clearInterval(interval); interval = undefined; note.textContent = message; render() }
  const startJob = (kind: 'scan' | 'select' | 'prefetch', position = 0, automatic?: string) => {
    job?.controller.abort()
    const current = { controller: new AbortController(), kind, from: Math.max(0, position - 5), to: position + 45, automatic }; job = current
    note.textContent = message(kind === 'scan' ? 'Looking for embedded MP4 text tracks…' : 'Reading embedded subtitles near this playback position…'); render(); return current
  }
  const errorText = (error: unknown) => tr(error instanceof SubtitleError ? error.message : 'The embedded subtitles could not be read. Try another track or load a subtitle file.')
  const load = async (id: number, update = false, automatic?: string) => {
    if (!session || !options.allowed()) return
    retryTrack = id
    const current = startJob(update ? 'prefetch' : 'select', options.position(), automatic), chosen = session
    try {
      const window = await chosen.read(id, options.position(), current.controller.signal)
      if (job !== current || current.controller.signal.aborted) return
      if (automatic && options.preferredLanguage?.() !== automatic) { note.textContent = ''; return }
      if (options.position() < window.from || options.position() >= window.to) { job = undefined; void load(id, update, automatic); return }
      if (!options.accept(prefix() + id, window.timeline, update)) throw new SubtitleError('The current captions could not be changed. Resume playback and try again.')
      coverage = window; active = id; failed = false; options.changed()
      note.textContent = message('Embedded MP4 text subtitles selected. Captions are read ahead as you watch; size and timing are adjustable.')
      clearInterval(interval); interval = setInterval(tick, 1000)
    } catch (error) {
      if (job === current && !current.controller.signal.aborted) { failed = true; if (update) { clearInterval(interval); interval = undefined }; note.textContent = errorText(error) }
    } finally { if (job === current) { job = undefined; render() } }
  }
  const tick = () => {
    if (active === undefined || !options.allowed() || options.activeId() !== prefix() + active) return
    if (job && job.kind !== 'prefetch') return
    const position = options.position()
    if (job && (position < job.from || position >= job.to)) { job.controller.abort(); job = undefined }
    if (!job && (position < coverage.from || position >= coverage.to - 15)) void load(active, true)
  }
  const scan = async (automatic?: string) => {
    const media = options.media()
    if (!media || !options.allowed() || embeddedSubtitleProblem(media) || busy()) return
    attempted = true; const current = startJob('scan', 0, automatic)
    try {
      const found = await openSession(media, current.controller.signal)
      if (job !== current || current.controller.signal.aborted) return
      session = found; options.changed()
      note.textContent = message(found.tracks.length ? 'Embedded MP4 text tracks found. Choose one from Subtitles.' : 'No supported embedded MP4 text tracks found. You can load an external subtitle file.')
    } catch (error) { if (job === current && !current.controller.signal.aborted) note.textContent = errorText(error) }
    finally { if (job === current) { job = undefined; render(); applyPreference() } }
  }
  const applyPreference = () => {
    const language = options.preferredLanguage?.()
    if (!language || !options.allowed() || busy() || automaticAttempted) return
    if (!attempted && !options.nativeTracks()) { void scan(language); return }
    if (!session) return
    let chosen: EmbeddedSubtitleSession['tracks'][number] | undefined, score = 0
    for (const track of session.tracks) { const current = languageScore(track.language, language); if (current > score) { chosen = track; score = current } }
    if (!chosen) return
    automaticAttempted = true; void load(chosen.id, false, language)
  }
  scanButton.onclick = () => { void scan() }
  cancelButton.onclick = () => {
    const keepPrevious = job?.kind === 'select' && active !== undefined && options.activeId() === prefix() + active
    failed = retryTrack !== undefined; cancel(tr('Subtitle reading cancelled. Choose a track or Retry to continue.'))
    if (keepPrevious) interval = setInterval(tick, 1000)
    ;(retry.hidden ? scanButton : retry).focus()
  }
  retry.onclick = () => { if (retryTrack !== undefined) void load(retryTrack, options.activeId() === prefix() + retryTrack) }
  return {
    tracks(): PlayerTrack[] { return session?.tracks.map(track => ({ id: prefix() + track.id, kind: 'subtitle', language: track.language, label: `${languageName(track.language) || tr('Unknown language')} · ${embeddedFormat(options.media())} ${track.id}${track.name ? ` · ${track.name}` : ''}`, active: options.activeId() === prefix() + track.id })) || [] },
    select(id: string) { const track = session?.tracks.find(track => prefix() + track.id === id); if (!track || !options.allowed()) return false; failed = false; void load(track.id); return true },
    open() { render(); if (!attempted && !options.nativeTracks()) void scan() },
    applyPreference,
    cancelAutomatic() { if (job?.automatic) { job.controller.abort(); job = undefined; note.textContent = ''; render() } },
    close() { if (job && job.kind !== 'prefetch' && !job.automatic) { job.controller.abort(); job = undefined; note.textContent = tr('Subtitle reading cancelled.'); render() } },
    deactivate() { cancel(); active = undefined; retryTrack = undefined; failed = false; render() },
    reset() { cancel(); session = undefined; attempted = false; automaticAttempted = false; active = undefined; retryTrack = undefined; failed = false; render() },
  }
}

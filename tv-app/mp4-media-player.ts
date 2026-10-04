import { browserHeaderProblem, webAddress, type Media } from './media'
import { languageName, type Player, type Report } from './player'
import type { Mp4MediaInfo, Mp4MediaSegment } from './mp4-media-session'
import { mediaFormat } from './media-format'

const ERROR = 'This MP4 could not play. Check provider access and the TV’s codec support. Try an HLS or DASH version if available.'
export function needsMp4Media(media: Media) {
  return !media.playback?.drm && media.mediaKind !== 'live' && !!Object.keys(media.playback?.headers || {}).length && mediaFormat(media) === 'mp4'
}
type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
export function mp4MediaPlayer(video: HTMLVideoElement, report: Report, createWorker = (): WorkerLike => new Worker('mp4-media-worker.js')): Player {
  let generation = 0, worker: WorkerLike | undefined, source: MediaSource | undefined, objectUrl: string | undefined
  let cleanup = () => {}, rejectPending: ((error: Error) => void) | undefined, requestId = 0
  let info: Mp4MediaInfo | undefined, selectedAudio: number | undefined, media: Media | undefined, polling: ReturnType<typeof setTimeout> | undefined
  let busy = false, ended = false, next = 0, desired: number | undefined, seekingPosition: number | undefined, userPaused = false, playRequested = false
  const buffers = new Map<number, SourceBuffer>()
  const pendingMutations = new Set<() => void>()
  const close = () => {
    generation++; clearTimeout(polling); cleanup(); cleanup = () => {}
    rejectPending?.(new Error('Cancelled')); rejectPending = undefined
    worker?.terminate(); worker = undefined
    for (const cancel of [...pendingMutations]) cancel()
    buffers.clear(); source = undefined
    video.pause(); video.removeAttribute('src'); video.load()
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined
    busy = false; ended = false; playRequested = false; seekingPosition = undefined
  }
  const fail = (token: number, message = ERROR) => { if (token === generation) { close(); report('error', message) } }
  const request = <T>(action: string, payload: object = {}): Promise<T> => new Promise((resolve, reject) => {
    if (!worker || rejectPending) { reject(new Error(ERROR)); return }
    const id = ++requestId, current = worker, timer = setTimeout(() => finish(new Error('This MP4 stopped responding. Check the connection and retry.')), 45000)
    const finish = (error?: Error, result?: T) => { clearTimeout(timer); current.onmessage = null; current.onerror = null; rejectPending = undefined; error ? reject(error) : resolve(result!) }
    rejectPending = error => finish(error)
    current.onerror = () => finish(new Error('This MP4 reader could not start. Reinstall the complete app package or try an HLS/DASH version.'))
    current.onmessage = event => { if (event.data?.id === id) event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data.result) }
    try { current.postMessage({ id, action, ...payload }) } catch { finish(new Error(ERROR)) }
  })
  const mutate = (buffer: SourceBuffer, action: () => void, token: number) => new Promise<void>((resolve, reject) => {
    if (token !== generation) { reject(new Error('Cancelled')); return }
    const finish = (error?: Error) => { clearTimeout(timer); pendingMutations.delete(cancel); buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', errorEvent); buffer.removeEventListener('abort', errorEvent); error ? reject(error) : resolve() }
    const cancel = () => finish(new Error('Cancelled'))
    const done = () => finish(), errorEvent = () => finish(new Error('This MP4 was rejected by the TV decoder. Try a different codec or an HLS/DASH version.')), timer = setTimeout(errorEvent, 10000)
    pendingMutations.add(cancel)
    buffer.addEventListener('updateend', done); buffer.addEventListener('error', errorEvent); buffer.addEventListener('abort', errorEvent)
    try { action() } catch { errorEvent() }
  })
  const ahead = () => {
    const position = video.currentTime
    for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= position + .15 && video.buffered.end(i) >= position) return video.buffered.end(i) - position
    return 0
  }
  const pump = async (token: number) => {
    if (token !== generation || busy || !source || !info) return
    if (desired === undefined && (ended || ahead() >= 18)) { polling = setTimeout(() => void pump(token), 500); return }
    busy = true
    try {
      const seek = desired; desired = undefined
      if (seek !== undefined) seekingPosition = seek
      const position = seek === undefined ? next : seek
      if (seek !== undefined) {
        ended = false
        for (const buffer of buffers.values()) if (buffer.buffered.length) await mutate(buffer, () => buffer.remove(0, Math.max(info!.duration + 2, buffer.buffered.end(buffer.buffered.length - 1))), token)
      } else {
        const before = video.currentTime - 10
        if (before > 5) for (const buffer of buffers.values()) if (buffer.buffered.length && buffer.buffered.start(0) < before - 2) await mutate(buffer, () => buffer.remove(0, before), token)
      }
      if (token !== generation) return
      const value = await request<Mp4MediaSegment>('segment', { position, reset: seek !== undefined })
      if (token !== generation) return
      if (desired !== undefined) return // A newer seek wins; do not append an obsolete window.
      for (const segment of value.segments) {
        const buffer = buffers.get(0); if (!buffer) throw new Error(ERROR)
        await mutate(buffer, () => buffer.appendBuffer(segment.buffer), token)
      }
      if (token !== generation || desired !== undefined) return
      next = value.next; ended = value.done
      if (seek !== undefined) { video.currentTime = seek; seekingPosition = undefined }
      if (userPaused) report('paused')
      if (!userPaused && !playRequested) { playRequested = true; void video.play().catch(() => fail(token)) }
      if (ended && source?.readyState === 'open') { source.duration = info.duration; source.endOfStream() }
    } catch (error) {
      const message = error instanceof Error && /^(This MP4|Cannot read this MP4)/.test(error.message) ? error.message : ERROR
      fail(token, message)
    } finally {
      if (token === generation) { busy = false; clearTimeout(polling); polling = setTimeout(() => void pump(token), desired === undefined ? 250 : 0) }
    }
  }
  const begin = (input: Media, position: number, audio?: number, paused = false) => {
    close(); const token = generation; media = input; info = undefined; selectedAudio = audio
    next = 0; desired = Number.isFinite(position) ? Math.max(0, position) : 0; userPaused = paused
    const problem = input.playback?.problem || browserHeaderProblem(input.playback?.headers)
    if (problem) { report('error', problem); return }
    if (input.playback?.drm || input.mediaKind === 'live' || Object.keys(input.playback?.headers || {}).some(name => /^(range|if-range)$/i.test(name))) { report('error', 'This MP4 needs a provider-supported HLS or DASH version.'); return }
    try { webAddress(input.url); if (typeof MediaSource === 'undefined') throw new Error() } catch { report('error', ERROR); return }
    report('loading', 'Opening MP4…')
    void (async () => {
      try {
        worker = createWorker(); const details = await request<Mp4MediaInfo>('open', { media: input }); if (token !== generation) return
        info = details; desired = Math.min(desired || 0, Math.max(0, info.duration - .1))
        const compatible = info.tracks.filter(t => MediaSource.isTypeSupported(t.mime))
        const v = compatible.find(t => t.kind === 'video'), a = compatible.find(t => t.kind === 'audio' && t.id === audio) || compatible.find(t => t.kind === 'audio')
        if (info.tracks.some(t => t.kind === 'video') && !v || info.tracks.some(t => t.kind === 'audio') && !a || !v && !a) throw new Error('This MP4 uses a codec that this device cannot play through its browser media engine. Try a different encoding or an HLS/DASH version.')
        selectedAudio = a?.id
        const chosen = [v, a].filter((t): t is NonNullable<typeof t> => !!t), initial = await request<{ id: number; buffer: ArrayBuffer }[]>('initialize', { tracks: chosen.map(t => t.id) })
        const mime = `${v ? 'video' : 'audio'}/mp4; codecs="${chosen.map(t => /codecs="([^"]+)"/.exec(t.mime)![1]).join(',')}"`
        if (!MediaSource.isTypeSupported(mime)) throw new Error('This MP4 audio/video combination is not supported by the TV media engine.')
        if (token !== generation) return
        const current = new MediaSource(); source = current
        const events: Record<string, () => void> = {
          playing: () => report('playing'), waiting: () => report('buffering'), pause: () => { if (playRequested) report('paused') }, error: () => fail(token),
          ended: () => { close(); report('ended') },
        }
        const remove: (() => void)[] = []
        for (const [name, handler] of Object.entries(events)) { const fn = () => { if (token === generation) handler() }; video.addEventListener(name, fn); remove.push(() => video.removeEventListener(name, fn)) }
        cleanup = () => remove.forEach(fn => fn())
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { dispose(); reject(new Error('This MP4 could not open the TV media engine. Retry playback or use an HLS/DASH version.')) }, 10000)
          const open = () => { dispose(); resolve() }
          const dispose = () => { clearTimeout(timer); current.removeEventListener('sourceopen', open) }
          remove.push(() => { dispose(); reject(new Error('Cancelled')) }); current.addEventListener('sourceopen', open)
          objectUrl = URL.createObjectURL(current); video.preload = 'auto'; video.src = objectUrl; video.load()
        })
        if (token !== generation) return
        current.duration = info.duration
        // A single multiplexed buffer also works on TV engines that limit source-buffer count.
        const buffer = current.addSourceBuffer(mime); buffers.set(0, buffer)
        await mutate(buffer, () => buffer.appendBuffer(initial[0].buffer), token)
        if (token === generation) void pump(token)
      } catch (error) { fail(token, error instanceof Error && /^(This MP4|Cannot read this MP4)/.test(error.message) ? error.message : ERROR) }
    })()
  }
  return {
    play(input, position = 0) { begin(typeof input === 'string' ? { url: input } : input, position) },
    stop() { close(); media = undefined; info = undefined; report('idle') },
    pause() { userPaused = true; video.pause() },
    resume() { userPaused = false; playRequested = true; const token = generation; void video.play().catch(() => fail(token)) },
    seek(delta) {
      if (!info || !Number.isFinite(delta)) return
      desired = Math.max(0, Math.min(info.duration - .1, (desired ?? seekingPosition ?? video.currentTime) + delta)); report('buffering')
      clearTimeout(polling); void pump(generation)
    },
    timeline() { return { position: desired ?? seekingPosition ?? (video.currentTime || 0), duration: info?.duration || 0 } },
    tracks() { return (info?.tracks || []).filter(t => t.kind === 'audio' && MediaSource.isTypeSupported(t.mime)).map(t => ({ id: String(t.id), kind: 'audio' as const, language: t.language, label: languageName(t.language) || 'Audio', active: t.id === selectedAudio })) },
    selectTrack(kind, id) {
      // Only audio/video enter MSE; allow the independent text renderer to take over.
      if (kind === 'subtitle') return id === 'off'
      const track = this.tracks?.().find(t => t.id === id); if (!track || !media) return false
      if (Number(id) !== selectedAudio) begin(media, desired ?? seekingPosition ?? video.currentTime, Number(id), userPaused)
      return true
    },
  }
}

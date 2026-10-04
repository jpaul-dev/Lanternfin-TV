// Focus/idle behavior adapted from the original Android TV Home view. Candidates
// come from the bounded rendered rails, never another pass over the catalog.
import type { Channel } from './catalog'
import { cardChannel, cardVersions } from './presentation'
import { channelId, durationLabel, type TVLibrary } from './library'
import { nowNext, timeRange, type Programme, type TVGuide } from './guide'
import { runtimeLabel } from './provider-runtime'
import { classifyEffectTier } from '../src/scripts/tv/motion'
import { tr } from './i18n'
import type { TitlePreviews } from './title-previews'
import type { TitleDetails } from './xtream'

type Entry = { channel: Channel; versions?: Channel[]; row: string; id: string }
type Options = {
  active: () => boolean
  reducedMotion: () => boolean
  library: () => TVLibrary | undefined
  guide: () => Pick<TVGuide, 'load'> | undefined
  clock: () => string
  previews?: () => Pick<TitlePreviews, 'read' | 'load'> | undefined
  activate: (channel: Channel, versions?: Channel[]) => void
  browse: () => void
}
export function homeHero(root: HTMLElement, options: Options) {
  const doc = root.ownerDocument, rows = root.querySelector<HTMLElement>('#home-rows')!
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  let art = el<HTMLImageElement>('hero-art')
  const play = el<HTMLButtonElement>('hero-play'), progress = el<HTMLProgressElement>('hero-progress')
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const lite = classifyEffectTier({ deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent }) === 'lite'
  let entries: Entry[] = [], selected: Entry | undefined, pending: Entry | undefined, active = false, disposed = false
  let focusTimer: ReturnType<typeof setTimeout> | undefined, rotation: ReturnType<typeof setTimeout> | undefined, guideTimer: ReturnType<typeof setTimeout> | undefined
  let guideLoading: AbortController | undefined, programmes: Programme[] = []
  let preview: TitleDetails | undefined, previewLoading: AbortController | undefined, previewDone = false, previewTimer: ReturnType<typeof setTimeout> | undefined
  const failedArtwork = new Set<string>()
  const available = () => !disposed && !doc.hidden && options.active()
  const rotating = () => !lite && !options.reducedMotion() && !motion?.matches
  function entry(element: Element | null): Entry | undefined {
    const card = element?.closest<HTMLElement>('.channel')
    if (!card || !rows.contains(card)) return
    const channel = cardChannel(card)
    if (channel) return { channel, versions: cardVersions(card), row: card.closest('.home-row')?.querySelector('h2')?.textContent || tr('From your library'), id: channelId(channel) }
  }
  function stopFocus() { clearTimeout(focusTimer); focusTimer = undefined; pending = undefined }
  function stopRotation() { clearTimeout(rotation); rotation = undefined }
  function stopGuide() { guideLoading?.abort(); guideLoading = undefined; clearTimeout(guideTimer); guideTimer = undefined }
  function stopPreview() {
    if (previewLoading || previewTimer) previewDone = false
    previewLoading?.abort(); previewLoading = undefined; clearTimeout(previewTimer); previewTimer = undefined
  }
  function render() {
    const channel = selected?.channel, library = options.library(), recent = channel && library?.lastPlayed(channel)
    const kind = channel?.mediaKind || 'live', live = !!channel && kind === 'live'
    const { current: now, next } = nowNext(programmes)
    const resume = !live && recent?.position ? tr('Continue from {position}', { position: durationLabel(recent.position) }) : ''
    el('hero-title').textContent = channel?.name || tr('Your evening starts here.')
    el('hero-kicker').textContent = selected?.row || tr('MAKE YOURSELF AT HOME')
    const facts = preview && kind !== 'episode' ? preview.metadata : [channel?.year, channel?.rating ? `${channel.rating.toFixed(1)} / 10` : '', runtimeLabel(channel?.durationSeconds), channel?.group]
    el('hero-meta').textContent = channel ? [tr(kind === 'movie' ? 'Movie' : kind === 'series' ? 'Series' : kind === 'episode' ? 'Episode' : 'Live TV'), ...facts, resume, library?.isWatched(channel) ? tr('Watched') : ''].filter(Boolean).join(' · ') : tr('Live television, movies, and series. All in one place.')
    const synopsis = kind === 'episode' ? channel?.description || preview?.description : preview?.description || channel?.description
    const description = live && now ? `${timeRange(now, options.clock())} · ${now.title}${next ? ` · ${tr('Next')}: ${next.title}` : ''}` : synopsis?.slice(0, 600) || ''
    el('hero-description').textContent = description; el('hero-description').hidden = !description
    progress.hidden = !(live ? now : recent?.duration && recent.position)
    progress.max = live && now ? now.stop - now.start : recent?.duration || 1
    progress.value = live && now ? Math.max(0, Date.now() - now.start) : recent?.position || 0
    progress.setAttribute('aria-label', tr(live ? 'Programme progress' : 'Viewing progress'))
    const image = [preview?.backdrop, preview?.poster, channel?.logo].find(url => url && !failedArtwork.has(url)) || ''
    if (art.getAttribute('src') !== (image || null)) {
      // A fresh image node makes a delayed error belong to its old selection.
      const next = doc.createElement('img'); next.id = 'hero-art'; next.alt = ''; next.hidden = !image; next.decoding = 'async'; next.referrerPolicy = 'no-referrer'
      next.onerror = () => {
        if (art !== next || !image) return
        failedArtwork.add(image); if (failedArtwork.size > 80) failedArtwork.delete(failedArtwork.values().next().value!)
        render()
      }
      art.hidden = true; art.onerror = null; art.removeAttribute('src'); art.replaceWith(next); art = next
      if (image) art.src = image
    }
    art.dataset.kind = image && image === preview?.backdrop ? 'backdrop' : 'poster'
    play.textContent = channel ? tr(kind === 'series' ? 'View episodes' : '▶ Watch now') : tr('Browse Live TV')
    // Keep the visible title and its versions together even across a refresh.
    play.onclick = () => { if (!available()) return; if (channel) options.activate(channel, selected?.versions); else options.browse() }
  }
  function loadPreview() {
    if (previewDone || previewLoading || previewTimer || !available()) return
    const channel = selected?.channel, store = options.previews?.()
    if (!channel || !['movie', 'series', 'episode'].includes(channel.mediaKind || '') || !store) return
    preview = store.read(channel)
    if (preview) { previewDone = true; render(); return }
    // Focus follows after 80 ms; network enrichment waits for a settled title.
    previewTimer = setTimeout(() => {
      previewTimer = undefined
      if (!available() || selected?.id !== channelId(channel) || options.previews?.() !== store) return
      const controller = new AbortController(); previewLoading = controller
      void store.load(channel, controller.signal).then(details => {
        if (previewLoading !== controller || controller.signal.aborted || !available() || options.previews?.() !== store) return
        preview = details; render()
      }).catch(() => { /* Keep catalog art and copy when provider metadata fails. */ }).finally(() => {
        if (previewLoading === controller) { previewLoading = undefined; previewDone = true }
      })
    }, 250)
  }
  function loadGuide() {
    stopGuide()
    const channel = selected?.channel, guide = options.guide()
    if (!available() || !channel || channel.mediaKind && channel.mediaKind !== 'live' || !guide) return
    const controller = new AbortController(); guideLoading = controller
    void guide.load(channel, controller.signal).then(items => {
      if (guideLoading !== controller || controller.signal.aborted || !available() || options.guide() !== guide) return
      programmes = items; render()
    }).catch(() => { /* An unavailable guide must not hide or disable the title. */ }).finally(() => {
      if (guideLoading !== controller || controller.signal.aborted || !available()) return
      guideLoading = undefined
      guideTimer = setTimeout(loadGuide, 60000)
    })
  }
  function choose(value: Entry | undefined) {
    const changed = value?.id !== selected?.id
    selected = value
    if (changed) { stopGuide(); programmes = []; stopPreview(); preview = undefined; previewDone = false }
    render()
    if (changed && active) loadGuide()
    if (active) loadPreview()
  }
  function armRotation() {
    if (rotation || !available() || !rotating() || entries.length < 2 || entry(doc.activeElement)) return
    rotation = setTimeout(() => {
      rotation = undefined
      if (!available() || !rotating() || entry(doc.activeElement)) { sync(); return }
      const index = entries.findIndex(value => value.id === selected?.id)
      choose(entries[(index + 1) % entries.length]); armRotation()
    }, 10000)
  }
  function sync() {
    if (!available()) { active = false; stopFocus(); stopRotation(); stopGuide(); stopPreview(); return }
    if (!active) { active = true; previewDone = false; render(); loadGuide(); loadPreview() }
    const focused = entry(doc.activeElement)
    if (focused) {
      stopRotation()
      if (focused.id !== selected?.id) stopPreview()
      if (focused.id === selected?.id && focused.row === selected?.row) { stopFocus(); choose(focused) }
      else if (pending?.id === focused.id && pending.row === focused.row) pending = focused
      else {
        stopFocus(); pending = focused
        focusTimer = setTimeout(() => { const next = pending; stopFocus(); if (available() && next?.id === entry(doc.activeElement)?.id) choose(next) }, 80)
      }
    } else { stopFocus(); if (!rotating()) stopRotation(); armRotation() }
  }
  function refresh() {
    // At most 17 rails x 12 cards today; defensively cap future layouts too.
    const cards = rows.getElementsByClassName('channel'), seen = new Set<string>(), next: Entry[] = []
    for (let index = 0; index < Math.min(cards.length, 240); index++) {
      const value = entry(cards[index]); if (!value || seen.has(value.id)) continue
      seen.add(value.id); next.push(value)
    }
    entries = next
    const focused = entry(doc.activeElement)
    choose(focused && focused.id === selected?.id ? focused : entries.find(value => value.id === selected?.id) || entries[0])
    if (entries.length < 2) stopRotation()
    sync()
  }
  function reset() { active = false; stopFocus(); stopRotation(); stopGuide(); stopPreview(); entries = []; selected = undefined; programmes = []; preview = undefined; previewDone = false; failedArtwork.clear(); render() }
  const focusChanged = () => { stopRotation(); sync() }
  doc.addEventListener('focusin', focusChanged)
  doc.addEventListener('visibilitychange', sync)
  if (motion?.addEventListener) motion.addEventListener('change', sync); else motion?.addListener?.(sync)
  render()
  return { refresh, sync, reset, dispose() {
    disposed = true; reset(); doc.removeEventListener('focusin', focusChanged); doc.removeEventListener('visibilitychange', sync)
    if (motion?.removeEventListener) motion.removeEventListener('change', sync); else motion?.removeListener?.(sync)
  } }
}

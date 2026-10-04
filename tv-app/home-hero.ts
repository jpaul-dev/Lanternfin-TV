// Focus/idle behavior adapted from the original Android TV Home view. Candidates
// come from the bounded rendered rails, never another pass over the catalog.
import type { Channel } from './catalog'
import { cardChannel, cardVersions } from './presentation'
import { channelId, durationLabel, type TVLibrary } from './library'
import { nowNext, timeRange, type Programme, type TVGuide } from './guide'
import { runtimeLabel } from './provider-runtime'
import { classifyEffectTier } from '../src/scripts/tv/motion'
import { tr } from './i18n'

type Entry = { channel: Channel; versions?: Channel[]; row: string; id: string }
type Options = {
  active: () => boolean
  reducedMotion: () => boolean
  library: () => TVLibrary | undefined
  guide: () => Pick<TVGuide, 'load'> | undefined
  clock: () => string
  activate: (channel: Channel, versions?: Channel[]) => void
  browse: () => void
}
export function homeHero(root: HTMLElement, options: Options) {
  const doc = root.ownerDocument, rows = root.querySelector<HTMLElement>('#home-rows')!
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const art = el<HTMLImageElement>('hero-art'), play = el<HTMLButtonElement>('hero-play'), progress = el<HTMLProgressElement>('hero-progress')
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const lite = classifyEffectTier({ deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent }) === 'lite'
  let entries: Entry[] = [], selected: Entry | undefined, pending: Entry | undefined, active = false, disposed = false
  let focusTimer: ReturnType<typeof setTimeout> | undefined, rotation: ReturnType<typeof setTimeout> | undefined, guideTimer: ReturnType<typeof setTimeout> | undefined
  let guideLoading: AbortController | undefined, programmes: Programme[] = []
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
  function render() {
    const channel = selected?.channel, library = options.library(), recent = channel && library?.lastPlayed(channel)
    const kind = channel?.mediaKind || 'live', live = !!channel && kind === 'live'
    const { current: now, next } = nowNext(programmes)
    const resume = !live && recent?.position ? tr('Continue from {position}', { position: durationLabel(recent.position) }) : ''
    el('hero-title').textContent = channel?.name || tr('Your evening starts here.')
    el('hero-kicker').textContent = selected?.row || tr('MAKE YOURSELF AT HOME')
    el('hero-meta').textContent = channel ? [tr(kind === 'movie' ? 'Movie' : kind === 'series' ? 'Series' : kind === 'episode' ? 'Episode' : 'Live TV'), channel.year, channel.rating ? `${channel.rating.toFixed(1)} / 10` : '', runtimeLabel(channel.durationSeconds), channel.group, resume, library?.isWatched(channel) ? tr('Watched') : ''].filter(Boolean).join(' · ') : tr('Live television, movies, and series. All in one place.')
    const description = live && now ? `${timeRange(now, options.clock())} · ${now.title}${next ? ` · ${tr('Next')}: ${next.title}` : ''}` : channel?.description?.slice(0, 600) || ''
    el('hero-description').textContent = description; el('hero-description').hidden = !description
    progress.hidden = !(live ? now : recent?.duration && recent.position)
    progress.max = live && now ? now.stop - now.start : recent?.duration || 1
    progress.value = live && now ? Math.max(0, Date.now() - now.start) : recent?.position || 0
    progress.setAttribute('aria-label', tr(live ? 'Programme progress' : 'Viewing progress'))
    const image = channel?.logo || ''
    if (art.getAttribute('src') !== (image || null)) {
      art.hidden = !image
      if (image) { art.referrerPolicy = 'no-referrer'; art.src = image; art.onerror = () => { art.hidden = true } }
      else { art.removeAttribute('src'); art.onerror = null }
    }
    play.textContent = channel ? tr(kind === 'series' ? 'View episodes' : '▶ Watch now') : tr('Browse Live TV')
    // Keep the visible title and its versions together even across a refresh.
    play.onclick = () => { if (!available()) return; if (channel) options.activate(channel, selected?.versions); else options.browse() }
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
    if (changed) { stopGuide(); programmes = [] }
    render()
    if (changed && active) loadGuide()
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
    if (!available()) { active = false; stopFocus(); stopRotation(); stopGuide(); return }
    if (!active) { active = true; render(); loadGuide() }
    const focused = entry(doc.activeElement)
    if (focused) {
      stopRotation()
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
  function reset() { active = false; stopFocus(); stopRotation(); stopGuide(); entries = []; selected = undefined; programmes = []; render() }
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

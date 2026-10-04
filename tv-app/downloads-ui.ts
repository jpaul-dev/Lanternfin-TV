import type { Channel } from './catalog'
import { TVDownloads, downloadProblem, type DownloadItem } from './downloads'
import { durationLabel } from './library'

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`
export function downloadsUI(root: HTMLElement, downloads: TVDownloads, play: (channel: Channel, position: number) => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#downloads-${id}`)!
  let selected: Channel | undefined, removal: string | undefined, signature = '', visible = false
  const status = (value: string) => { el('status').textContent = value }
  const attempt = async (fn: () => void | Promise<void>) => { try { await fn() } catch (error) { status(error instanceof Error ? error.message : 'This action could not finish. Try again.') } }
  const action = (name: string, key: string, text: string, run: () => void) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.action = `${key}-${name}`; button.onclick = run; return button }
  const render = () => {
    if (!visible) return
    const items = downloads.list(), next = JSON.stringify(items.map(item => [item.key, item.state, item.position]))
    el('count').textContent = `${items.length} saved ${items.length === 1 ? 'entry' : 'entries'}`
    el('size').textContent = `${size(items.reduce((sum, item) => sum + item.received, 0))} saved`
    el('empty').hidden = !!items.length
    if (signature !== next) {
      const focused = (document.activeElement as HTMLElement | null)?.dataset.action
      el('list').replaceChildren(); signature = next
      for (const item of items) {
        const row = document.createElement('article'); row.className = 'download-row'; row.dataset.key = item.key
        const heading = document.createElement('h2'); heading.textContent = item.name
        const kind = document.createElement('p'); kind.className = 'eyebrow'; kind.textContent = item.kind === 'episode' ? 'EPISODE' : 'MOVIE'
        const detail = document.createElement('p'); detail.className = 'hint download-status'
        const progress = document.createElement('progress'); progress.setAttribute('aria-label', `Download progress: ${item.name}`)
        const actions = document.createElement('div'); actions.className = 'actions'
        if (item.state === 'complete') {
          actions.append(action('play', item.key, item.position ? `Continue · ${durationLabel(item.position)}` : 'Watch offline', () => { void attempt(() => play(downloads.channel(item.key), item.position)) }))
          if (item.position) actions.append(action('restart', item.key, 'Play from beginning', () => { void attempt(() => play(downloads.channel(item.key), 0)) }))
        }
        if (item.state === 'downloading' || item.state === 'starting') actions.append(action('pause', item.key, 'Pause download', () => downloads.pause(item.key)))
        if (item.state === 'paused') actions.append(action('resume', item.key, 'Resume download', () => { void attempt(() => downloads.resume(item.key)) }))
        if (item.state !== 'complete' && item.state !== 'failed') actions.append(action('cancel', item.key, 'Cancel download', () => downloads.cancel(item.key)))
        else actions.append(action('remove', item.key, 'Remove download', () => { removal = item.key; el('remove-title').textContent = `Remove “${item.name}” from this TV?`; el('removal').hidden = false; el('keep').focus() }))
        row.append(kind, heading, detail, progress, actions); el('list').append(row)
      }
      if (focused) (el('list').querySelector<HTMLElement>(`[data-action="${focused}"]`) || el('list').querySelector<HTMLElement>('button') || el('back')).focus()
    }
    for (const item of items) {
      const row = el('list').querySelector<HTMLElement>(`[data-key="${item.key}"]`)!, progress = row.querySelector('progress')!
      row.querySelector('.download-status')!.textContent = `${label(item)} · ${size(item.received)}${item.total ? ` of ${size(item.total)}` : ''}${item.note ? ` · ${item.note}` : ''}`
      progress.hidden = item.state === 'complete' || item.state === 'failed'
      if (item.total) { progress.max = item.total; progress.value = item.received } else progress.removeAttribute('value')
    }
    if (downloads.message) status(downloads.message)
  }
  const closeReview = () => { selected = undefined; el('review').hidden = true }
  const closeRemoval = () => { removal = undefined; el('removal').hidden = true }
  el('cancel').onclick = () => { closeReview(); el('back').focus(); status('Nothing downloaded.') }
  el('start').onclick = async () => {
    if (!selected) return
    const channel = selected; closeReview(); status('Preparing TV storage…')
    await attempt(async () => { await downloads.start(channel); status('Download started. You can leave this screen and keep browsing.') })
    render(); el('list').querySelector<HTMLElement>('button')?.focus()
  }
  el('keep').onclick = () => { closeRemoval(); el('back').focus() }
  el('remove').onclick = async () => { if (!removal) return; const key = removal; closeRemoval(); await attempt(async () => { await downloads.remove(key); status('Download removed from this TV.') }); render(); el('back').focus() }
  el('refresh').onclick = () => { downloads.refresh(); status('Transfer states checked.'); render() }
  downloads.onChange = render
  return {
    open(channel?: Channel) {
      visible = true; signature = ''; downloads.load(); closeReview(); closeRemoval(); status('')
      el('support').textContent = downloads.supported ? 'Offline viewing on this Samsung TV. Actual formats and storage depend on the TV.' : 'Offline downloads need Samsung’s native transfer service and app-private storage. This environment cannot save these movie files.'
      el('refresh').hidden = !downloads.supported
      if (channel) {
        const problem = downloads.supported ? downloadProblem(channel) : 'Downloads are unavailable on this device.'
        if (problem) status(problem)
        else { selected = channel; el('title').textContent = channel.name; el('review').hidden = false }
      }
      render()
    },
    close() { visible = false; closeReview(); closeRemoval() },
    back() { if (removal) { closeRemoval(); el('back').focus(); return true }; if (selected) { closeReview(); el('back').focus(); return true }; return false },
  }
}
function label(item: DownloadItem) { return ({ starting: 'Starting', downloading: 'Downloading', paused: 'Paused', canceling: 'Canceling', complete: 'Ready', failed: 'Needs attention' })[item.state] }

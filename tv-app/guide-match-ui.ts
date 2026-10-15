import { keyAction } from './remote'
import type { GuideChoices } from './xmltv'

export function guideMatchUI(root: HTMLElement, load: (query: string, page: number, signal: AbortSignal) => Promise<GuideChoices>, save: (id?: string) => void, back: () => void) {
  const el = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`#guide-match-${name}`)!
  const search = el<HTMLInputElement>('search'), list = el('list')
  let active = false, generation = 0, request: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let page = 0, pages = 0, selected: string | undefined, released = true
  const stop = () => { generation++; request?.abort(); request = undefined; clearTimeout(timer); timer = undefined; list.replaceChildren(); el<HTMLButtonElement>('previous').disabled = el<HTMLButtonElement>('next').disabled = true }
  const commit = (id?: string) => {
    if (!active) return
    try { save(id); back() } catch (error) { el('status').textContent = (error as Error).message }
  }
  async function find(focus = false) {
    if (!active) return
    stop(); const revision = generation, controller = new AbortController(); request = controller
    el('status').textContent = 'Reading guide channels…'; el('page').textContent = ''
    try {
      const result = await load(search.value, page, controller.signal)
      if (!active || generation !== revision || controller.signal.aborted) return
      page = result.page; pages = result.pages
      for (const item of result.items) {
        const button = document.createElement('button'), name = document.createElement('strong'), id = document.createElement('small')
        button.type = 'button'; button.className = 'guide-match-choice'; button.setAttribute('aria-pressed', String(item.id === selected))
        name.textContent = `${item.id === selected ? '✓ ' : ''}${item.name}`; id.textContent = item.id; button.append(name, id)
        button.onclick = () => { if (generation === revision) commit(item.id) }; list.append(button)
      }
      el('status').textContent = result.total ? `${result.total} guide ${result.total === 1 ? 'channel' : 'channels'}. Choose a channel to apply its schedule.` : 'No matching guide channels. Try another name or channel ID.'
      el('page').textContent = pages ? `Page ${page + 1} of ${pages}` : 'No matches'
      el<HTMLButtonElement>('previous').disabled = page === 0; el<HTMLButtonElement>('next').disabled = page + 1 >= pages
      if (focus) (list.querySelector<HTMLButtonElement>('button') || search).focus()
    } catch (error) { if (active && generation === revision) el('status').textContent = (error as Error).message }
    finally { if (request === controller) request = undefined }
  }
  function turn(delta: number) { if (!active || page + delta < 0 || page + delta >= pages) return; page += delta; void find(true) }
  search.oninput = () => { if (!active) return; stop(); page = 0; pages = 0; el('status').textContent = 'Searching guide channels…'; el('page').textContent = ''; timer = setTimeout(() => { void find() }, 200) }
  search.onkeydown = event => { if (event.key === 'Enter' || event.keyCode === 13) { event.preventDefault(); void find(true) } }
  el('previous').onclick = () => turn(-1); el('next').onclick = () => turn(1)
  el('refresh').onclick = () => { void find() }; el('automatic').onclick = () => commit(); el('back').onclick = back
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const enter = event.key === 'Enter' || event.keyCode === 13
    if (enter && !released) { event.preventDefault(); event.stopImmediatePropagation(); return }
    if (!active || !root.contains(document.activeElement)) return
    if (enter) { released = false; return }
    const action = keyAction(event.key, event.keyCode)
    if (action === 'channel-up' || action === 'channel-down') { event.preventDefault(); event.stopImmediatePropagation(); turn(action === 'channel-up' ? -1 : 1) }
  }
  const keyup = (event: KeyboardEvent) => { if (!released && (event.key === 'Enter' || event.keyCode === 13)) { released = true; event.preventDefault(); event.stopImmediatePropagation() } }
  const release = () => { released = true }
  document.addEventListener('keydown', keydown, true); document.addEventListener('keyup', keyup, true)
  window.addEventListener('blur', release); window.addEventListener('pagehide', release)
  return {
    open(name: string, current?: string, persistent = false) {
      stop(); active = true; selected = current; page = 0; pages = 0; search.value = ''
      el('title').textContent = `Match guide for ${name}`
      el('current').textContent = current ? `Custom match: ${current}. If this ID leaves the feed, choose another match or use automatic matching.` : 'Automatic matching uses the playlist channel ID, then a unique channel name.'
      el('storage').textContent = persistent ? 'Saved for this source on this TV. Encrypted library backups include guide matches.' : 'Applies for this session. Remember the source to keep its guide matches.'
      el<HTMLButtonElement>('automatic').disabled = !current
      search.disabled = false; el<HTMLButtonElement>('refresh').disabled = false
      void find()
    },
    close() { stop(); active = false; search.disabled = true; el<HTMLButtonElement>('refresh').disabled = el<HTMLButtonElement>('automatic').disabled = true; el('page').textContent = ''; el('status').textContent = 'Search stopped. Return to the guide and reopen matching to try again.' },
    dispose() { this.close(); document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', release); window.removeEventListener('pagehide', release) },
  }
}

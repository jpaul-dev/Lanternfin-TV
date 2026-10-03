import type { TVLibrary, LibraryArea } from './library'

const AREAS: Record<LibraryArea, string> = { favorites: 'favorite marks', history: 'recent entries and resume positions', watched: 'watched marks', seasons: 'saved season choices' }
/** Current source only. Selecting options never mutates a library; review precedes apply. */
export function libraryUI(root: HTMLElement, changed: () => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#manage-${id}`)!
  let library: TVLibrary | undefined, pending: LibraryArea[] | undefined, undo: (() => void) | undefined
  const status = (text: string) => { el('status').textContent = text }
  const selected = () => (Object.keys(AREAS) as LibraryArea[]).filter(area => el<HTMLInputElement>(area).checked)
  const counts = () => {
    const counts = library?.counts()
    for (const area of Object.keys(AREAS) as LibraryArea[]) {
      const value = counts?.[area] || 0, input = el<HTMLInputElement>(area)
      el(`${area}-count`).textContent = String(value); input.disabled = !value; if (!value) input.checked = false
    }
    el<HTMLButtonElement>('review').disabled = !selected().length
  }
  const closeReview = () => { pending = undefined; el('confirmation').hidden = true }
  for (const area of Object.keys(AREAS)) el(area).onchange = () => { closeReview(); counts() }
  el('review').onclick = () => {
    pending = selected(); if (!pending.length || !library) return
    const count = library.counts()
    el('summary').textContent = pending.map(area => `${count[area]} ${AREAS[area]}`).join(' · ')
    el('confirmation').hidden = false; el('cancel').focus(); status('Review this change. Other sources and your provider’s catalog are unaffected.')
  }
  el('cancel').onclick = () => { closeReview(); el('review').focus(); status('Nothing changed.') }
  el('apply').onclick = () => {
    if (!library || !pending?.length) return
    try {
      undo = library.clearAreas(pending); closeReview(); counts(); changed(); el('undo').hidden = false; el('undo').focus()
      status('Selected library data cleared. Undo is available here until the next library change or until you leave this screen.')
    } catch (error) { status((error as Error).message) }
  }
  el('undo').onclick = () => {
    if (!undo) return
    try { undo(); undo = undefined; el('undo').hidden = true; counts(); changed(); status('Library data restored.'); el('back').focus() }
    catch (error) { status((error as Error).message) }
  }
  const close = () => { library = undefined; pending = undefined; undo = undefined; el('confirmation').hidden = true; el('undo').hidden = true }
  return {
    close,
    open(value: TVLibrary | undefined, name: string) {
      close(); library = value; el('source').textContent = name; status(value ? '' : 'Open a source before managing its library.')
      for (const area of Object.keys(AREAS)) el<HTMLInputElement>(area).checked = false
      counts()
    },
    back() { if (pending) { closeReview(); el('review').focus(); return true }; return false },
  }
}

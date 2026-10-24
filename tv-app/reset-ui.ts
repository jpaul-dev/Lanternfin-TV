export function resetUI(root: HTMLElement, run: (removeDownloads: boolean) => Promise<void>, restart: () => void) {
  const el = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`#reset-${name}`)!
  let started = false, busy = false, visible = false, released = true
  const confirm = el<HTMLInputElement>('confirm'), files = el<HTMLInputElement>('files'), apply = el<HTMLButtonElement>('apply')
  const sync = () => {
    apply.disabled = busy || !confirm.checked
    confirm.disabled = files.disabled = started
    for (const id of ['back', 'backup', 'downloads']) el<HTMLButtonElement>(id).disabled = started
    el<HTMLButtonElement>('restart').disabled = busy
    el('restart').hidden = !started
    root.setAttribute('aria-busy', String(busy))
  }
  confirm.onchange = sync
  files.onchange = () => { el('download-note').textContent = files.checked ? 'Downloaded videos, unfinished transfers and offline viewing progress will also be removed. Video files cannot be restored from a backup.' : 'Downloaded videos, offline progress and transfer details (including provider addresses and headers) will be kept. Transfers will pause; resume them in Downloads after the reset.' }
  apply.onclick = async () => {
    if (!visible || busy || !confirm.checked) return
    started = busy = true; sync(); el('status').textContent = 'Resetting app data… Keep the app open until this finishes.'
    try { await run(files.checked); el('status').textContent = 'Reset complete. Restarting Lanternfin…'; apply.hidden = true; restart() }
    catch { el('status').textContent = 'Reset could not finish. Some selected data may already have been removed. Retry, or restart the app and check Downloads and TV storage. Your other TV apps were not reset.'; apply.textContent = 'Retry reset' }
    finally { busy = false; sync(); (apply.hidden ? el('restart') : apply).focus() }
  }
  el('restart').onclick = () => { if (started && !busy) restart() }
  // Holding OK must not arm and then execute the destructive action as focus moves.
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.keyCode !== 13) return
    if (event.repeat || !released) { event.preventDefault(); event.stopImmediatePropagation(); return }
    released = false
  }, true)
  document.addEventListener('keyup', event => { if (event.key === 'Enter' || event.keyCode === 13) released = true })
  return {
    get locked() { return started },
    open() { if (started) return; visible = true; released = true; confirm.checked = files.checked = false; apply.hidden = false; apply.textContent = 'Reset app data'; el('status').textContent = ''; files.dispatchEvent(new Event('change')); sync() },
    close() { if (started) return; visible = false; confirm.checked = files.checked = false; sync() },
  }
}

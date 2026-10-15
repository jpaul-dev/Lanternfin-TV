import { BACKUP_TEXT, createBackup, decryptBackup, encryptBackup, restoreBackup, type Backup } from './backup'

export function backupUI(root: HTMLElement, storage: () => Storage, restored: (count: number) => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const input = (id: string) => el<HTMLInputElement>(id)
  let generation = 0, encrypted = '', pending: Backup | undefined, busy = false
  const status = (text: string) => { el('backup-status').textContent = text }
  const lock = (value: boolean) => { busy = value; for (const field of root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('input, textarea, button:not(#backup-back)')) field.disabled = value }
  const reset = () => {
    generation++; encrypted = ''; pending = undefined; lock(false)
    for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=checkbox]), textarea')) field.value = ''
    el('backup-created').hidden = el('backup-review').hidden = true
    el('backup-text').hidden = true; el('backup-show-text').setAttribute('aria-expanded', 'false')
    input('backup-library').checked = true; input('backup-preferences').checked = false; status('')
  }
  el('backup-export').onclick = async () => {
    if (busy) return
    const passphrase = input('backup-passphrase').value
    if (passphrase !== input('backup-confirm').value) { status('The passphrases do not match.'); return }
    const token = ++generation; lock(true); status('Encrypting your saved sources and library…')
    encrypted = ''; el('backup-created').hidden = true; pending = undefined; el('backup-review').hidden = true
    try {
      const result = await encryptBackup(createBackup(storage()), passphrase)
      if (token !== generation) return
      encrypted = result; el<HTMLTextAreaElement>('backup-output').value = result; el('backup-created').hidden = false
      status('Encrypted backup ready. Save the file or copy its text, and keep the passphrase separately. No backup was uploaded.')
    } catch (error) { if (token === generation) status((error as Error).message) }
    finally { if (token === generation) { input('backup-passphrase').value = input('backup-confirm').value = ''; lock(false); if (encrypted) el('backup-download').focus() } }
  }
  el('backup-download').onclick = () => {
    if (!encrypted) return
    const url = URL.createObjectURL(new Blob([encrypted], { type: 'application/json' })), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `Lanternfin-backup-${new Date().toISOString().slice(0, 10)}.lftv`; anchor.hidden = true; root.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    status('Save requested. If this TV cannot save files, copy the encrypted text using a supported browser or keyboard.')
  }
  el('backup-show-text').onclick = () => { const show = el('backup-text').hidden; el('backup-text').hidden = !show; el('backup-show-text').setAttribute('aria-expanded', String(show)); if (show) el('backup-output').focus() }
  el('backup-copy').onclick = async () => {
    const token = generation
    try { if (!encrypted || !navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(encrypted); if (token === generation) status('Encrypted backup text copied. Keep the passphrase separately.') }
    catch { if (token === generation) { status('Clipboard access is unavailable here. Use Save file or select the encrypted text with a keyboard.'); el('backup-text').hidden = false; el('backup-show-text').setAttribute('aria-expanded', 'true'); el('backup-output').focus() } }
  }
  input('backup-file').onchange = async () => {
    const token = ++generation, file = input('backup-file').files?.[0]; pending = undefined; el('backup-review').hidden = true
    if (!file) return
    if (file.size > BACKUP_TEXT) { status('This backup exceeds the 12 MiB file limit.'); input('backup-file').value = ''; return }
    lock(true)
    try { const text = await file.text(); if (token === generation) { el<HTMLTextAreaElement>('backup-input').value = text; status('Backup file loaded. Enter its passphrase and choose Review backup.') } }
    catch { if (token === generation) status('The backup file could not be read.') }
    finally { if (token === generation) lock(false) }
  }
  for (const id of ['backup-input', 'restore-passphrase']) el(id).oninput = () => { pending = undefined; el('backup-review').hidden = true }
  el('backup-decrypt').onclick = async () => {
    if (busy) return
    const token = ++generation; lock(true); pending = undefined; el('backup-review').hidden = true; status('Opening encrypted backup…')
    try {
      const result = await decryptBackup(el<HTMLTextAreaElement>('backup-input').value, input('restore-passphrase').value)
      if (token !== generation) return
      pending = result
      el('backup-summary').textContent = `${result.profiles.length} saved sources · ${result.profiles.reduce((n, profile) => n + profile.library.favorites.length, 0)} favorite marks · ${result.profiles.reduce((n, profile) => n + profile.library.watchlist.length, 0)} watchlist titles · ${result.profiles.reduce((n, profile) => n + profile.library.recent.length, 0)} recent records · ${result.profiles.filter(profile => profile.library.homeLayout).length} source layouts · ${result.profiles.reduce((n, profile) => n + (profile.library.guideMatches?.length || 0), 0)} guide matches`
      el('backup-review').hidden = false; status('Backup verified. Review the restore options below. Nothing has been saved yet.')
    } catch (error) { if (token === generation) status((error as Error).message) }
    finally { if (token === generation) { input('restore-passphrase').value = ''; lock(false); if (pending) el('backup-restore').focus() } }
  }
  el('backup-restore').onclick = () => {
    if (!pending || busy) return
    try {
      const count = restoreBackup(storage(), pending, { library: input('backup-library').checked, preferences: input('backup-preferences').checked })
      reset(); restored(count)
    } catch (error) { status((error as Error).message) }
  }
  return { open: reset, close: reset }
}

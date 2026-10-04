// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { backupUI } from '../tv-app/backup-ui'
import { MemoryStore } from '../tv-app/backup'
import { readProfiles, rememberProfile } from '../tv-app/profiles'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('requires review before restoring and clears secrets and pending results when closed', async () => {
  document.documentElement.innerHTML = readFileSync('tv-app/index.html', 'utf8')
  vi.stubGlobal('crypto', webcrypto)
  const root = document.getElementById('backup')!, storage = new MemoryStore(), restored = vi.fn()
  rememberProfile(storage, { kind: 'playlist', url: 'https://example.com/list', username: '', password: '' }, 'Example')
  const ui = backupUI(root, () => storage, restored), input = (id: string) => document.getElementById(id) as HTMLInputElement
  const click = (id: string) => input(id).click()
  root.hidden = false; ui.open(); input('backup-passphrase').value = input('backup-confirm').value = 'test backup passphrase only'
  click('backup-export'); await vi.waitFor(() => expect(input('backup-export').disabled).toBe(false))
  expect(input('backup-passphrase').value).toBe(''); expect(input('backup-confirm').value).toBe('')
  const encrypted = input('backup-output').value; expect(encrypted).toContain('lanternfin-encrypted'); expect(encrypted).not.toContain('example.com')
  storage.clear(); input('backup-input').value = encrypted; input('restore-passphrase').value = 'test backup passphrase only'
  click('backup-decrypt'); await vi.waitFor(() => expect(input('backup-decrypt').disabled).toBe(false))
  expect(input('backup-review').hidden).toBe(false); expect(readProfiles(storage)).toEqual([])
  expect(input('restore-passphrase').value).toBe(''); click('backup-restore')
  expect(restored).toHaveBeenCalledWith(1); expect(readProfiles(storage)).toHaveLength(1)
  expect(input('backup-input').value).toBe(''); expect(input('backup-output').value).toBe('')
  let finish!: (value: ArrayBuffer) => void
  vi.spyOn(webcrypto.subtle, 'encrypt').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  input('backup-passphrase').value = input('backup-confirm').value = 'test backup passphrase only'; click('backup-export')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); ui.close(); finish(new ArrayBuffer(32))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(input('backup-created').hidden).toBe(true); expect(input('backup-output').value).toBe(''); expect(input('backup-export').disabled).toBe(false)
})

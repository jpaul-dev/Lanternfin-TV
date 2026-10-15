import { validateSource, type Source } from './catalog'
const KEY = 'lanternfin.tv.source.v1'
export function readSource(storage: Storage): Source | null {
  try { const value = storage.getItem(KEY); return value && value.length <= 16384 ? validateSource(JSON.parse(value)) : null } catch { return null }
}
export function storeSource(storage: Storage, source: Source | null): void {
  // Deliberately opt-in. TV browser storage is not an encrypted credential vault.
  if (source) storage.setItem(KEY, JSON.stringify(validateSource(source)))
  else storage.removeItem(KEY)
}

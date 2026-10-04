import type { Channel, Source } from './catalog'
import { HOME_ROWS, type HomeRow } from './home-config'
import type { Category, MediaKind } from './xtream'

export const MAX_CATEGORY_ROWS = 8
export type CategoryRowId = `category-${number}`
export type HomeRowId = HomeRow | CategoryRowId
export type HomeCategory = { id: CategoryRowId; kind: MediaKind; title: string; categoryId?: string; group?: string }
export type SourceHome = { rows: HomeRowId[]; categories: HomeCategory[] }
export type CategoryChoice = Omit<HomeCategory, 'id'>
export type CategoryChoices = { choices: CategoryChoice[]; more: boolean }
export const categoryIdentity = (row: CategoryChoice) => JSON.stringify([row.kind, row.categoryId ?? null, row.group ?? null])
export const homeKind = (channel: Channel): MediaKind => channel.mediaKind === 'episode' ? 'series' : channel.mediaKind || 'live'
export const cloneSourceHome = (value: SourceHome): SourceHome => ({ rows: [...value.rows], categories: value.categories.map(row => ({ ...row })) })

/** Strict bounded schema shared by storage, backups and the editor. No addresses. */
export function readSourceHome(value: unknown, source: Source): SourceHome | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const data = value as SourceHome
  if (!Array.isArray(data.categories) || data.categories.length > MAX_CATEGORY_ROWS || !Array.isArray(data.rows) || data.rows.length > Object.keys(HOME_ROWS).length + MAX_CATEGORY_ROWS) return
  const categories: HomeCategory[] = [], ids = new Set<string>(), identities = new Set<string>()
  for (const row of data.categories) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !/^category-[0-7]$/.test(row.id) || !['live', 'movie', 'series'].includes(row.kind) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 200) return
    const clean: HomeCategory = { id: row.id, kind: row.kind, title: row.title.trim() }
    if (source.kind === 'xtream') {
      if (typeof row.categoryId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.categoryId) || row.group !== undefined) return
      clean.categoryId = row.categoryId
    } else if (source.kind === 'playlist') {
      if (typeof row.group !== 'string' || !row.group || row.group.length > 100 || row.categoryId !== undefined) return
      clean.group = row.group
    } else return
    const identity = categoryIdentity(clean)
    if (ids.has(row.id) || identities.has(identity)) return
    ids.add(row.id); identities.add(identity); categories.push(clean)
  }
  if (new Set(data.rows).size !== data.rows.length || data.rows.some(id => typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(HOME_ROWS, id) && !ids.has(id))) return
  return { rows: [...data.rows], categories }
}

/** Search loaded categories without making thousands of select options or freezing a playlist scan. */
export async function findHomeCategories(source: Source, channels: Channel[], provider: Partial<Record<MediaKind, Category[]>>, kind: MediaKind, query: string, signal: AbortSignal): Promise<CategoryChoices> {
  const choices: CategoryChoice[] = [], seen = new Set<string>(), needle = query.trim().toLocaleLowerCase()
  let started = performance.now(), processed = 0
  const check = () => { if (signal.aborted) throw new Error('Category search canceled.') }
  const add = (choice: CategoryChoice) => {
    if (!choice.title.toLocaleLowerCase().includes(needle)) return false
    const key = categoryIdentity(choice); if (seen.has(key)) return false
    seen.add(key); choices.push(choice); return choices.length > 100
  }
  const pause = async () => { if (performance.now() - started >= 10) { await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now() }; check() }
  check()
  if (source.kind === 'xtream') {
    for (const category of provider[kind] || []) {
      if (add({ kind, title: category.name.trim() || 'Unnamed category', categoryId: category.id })) break
      if (++processed % 512 === 0) await pause()
    }
  } else if (source.kind === 'playlist') {
    for (const channel of channels) {
      if (homeKind(channel) === kind && add({ kind, title: channel.group, group: channel.group })) break
      if (++processed % 512 === 0) await pause()
    }
  }
  check(); return { choices: choices.slice(0, 100), more: choices.length > 100 }
}

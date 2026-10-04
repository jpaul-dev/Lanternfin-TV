import type { Channel, Source } from './catalog'
import type { MediaKind } from './xtream'
import { homeKind } from './source-home'

export type CategoryRule = { mode: 'hide' | 'select'; ids: string[] }
export type CategoryRules = Partial<Record<MediaKind, CategoryRule>>
export const MAX_CATEGORY_RULES = 10000
const kinds: MediaKind[] = ['live', 'movie', 'series']

/** A per-source browsing preference, never a parental lock or a loading policy. */
export function readCategoryRules(value: unknown, source: Source): CategoryRules | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const result: CategoryRules = {}; let count = 0
  for (const [kind, entry] of Object.entries(value)) {
    if (!kinds.includes(kind as MediaKind) || !entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const rule = entry as CategoryRule
    if (!['hide', 'select'].includes(rule.mode) || !Array.isArray(rule.ids) || rule.ids.length > MAX_CATEGORY_RULES) return
    const ids = new Set<string>()
    for (const id of rule.ids) {
      if (typeof id !== 'string' || !id.length || id.length > 100 || /[\u0000-\u001f]/.test(id) || source.kind === 'xtream' && !/^[A-Za-z0-9_-]{1,80}$/.test(id) || ids.has(id)) return
      ids.add(id)
    }
    count += ids.size; if (count > MAX_CATEGORY_RULES) return
    result[kind as MediaKind] = { mode: rule.mode, ids: [...ids] }
  }
  return result
}
export function cloneCategoryRules(rules: CategoryRules): CategoryRules {
  const result: CategoryRules = {}
  for (const kind of kinds) { const rule = rules[kind]; if (rule) result[kind] = { mode: rule.mode, ids: [...rule.ids] } }
  return result
}
/** Compile once per edit; a 500,000-title scan must not search an array for each title. */
export function categoryVisibility(source: Source, rules: CategoryRules) {
  const sets = new Map(kinds.map(kind => [kind, new Set(rules[kind]?.ids || [])]))
  const category = (kind: MediaKind, id: string) => {
    const rule = rules[kind], ids = sets.get(kind)!
    // The Android app also treats an empty selection as all categories.
    return !rule || !ids.size || !!id && (rule.mode === 'select' ? ids.has(id) : !ids.has(id))
  }
  return { category, channel: (channel: Channel, memberships?: string | Iterable<string>) => {
    const kind = homeKind(channel)
    if (source.kind !== 'xtream') return category(kind, channel.group)
    if (memberships && typeof memberships !== 'string') {
      for (const id of memberships) if (category(kind, id)) return true
      return false
    }
    return category(kind, channel.categoryId || memberships || '')
  } }
}

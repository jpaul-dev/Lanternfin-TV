import { LANGUAGE_TOKENS } from '../src/scripts/lib/language-tags'

export const BROWSE_VIEWS = ['movie', 'series', 'search', 'all', 'favorites', 'watchlist', 'recent'] as const
export type BrowseView = typeof BROWSE_VIEWS[number]
export type BrowseChoice = { sort: 'provider' | 'newest' | 'rating' | 'name-asc' | 'name-desc'; watched: 'all' | 'watched' | 'unwatched'; language: string; media: '' | 'live' | 'movie' | 'series' }
export type BrowseOptions = Partial<Record<BrowseView, BrowseChoice>>
export const DEFAULT_BROWSE_CHOICE: Readonly<BrowseChoice> = { sort: 'provider', watched: 'all', language: '', media: '' }

/** Closed, bounded settings schema; queries, category names and addresses are never stored here. */
export function readBrowseOptions(raw: unknown): BrowseOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const entries = Object.entries(raw)
  if (entries.length > BROWSE_VIEWS.length) return
  const result: BrowseOptions = {}
  for (const [view, choice] of entries) {
    if (!BROWSE_VIEWS.includes(view as BrowseView) || !choice || typeof choice !== 'object' || Array.isArray(choice)) return
    if (!['provider', 'newest', 'rating', 'name-asc', 'name-desc'].includes(choice.sort) || !['all', 'watched', 'unwatched'].includes(choice.watched) || !['', 'live', 'movie', 'series'].includes(choice.media)) return
    if (typeof choice.language !== 'string' || choice.language.length > 32 || choice.language !== '' && choice.language !== 'untagged' && !Object.prototype.hasOwnProperty.call(LANGUAGE_TOKENS, choice.language)) return
    result[view as BrowseView] = { sort: choice.sort, watched: choice.watched, language: choice.language, media: choice.media }
  }
  return result
}
export function cloneBrowseOptions(value: BrowseOptions): BrowseOptions { return Object.fromEntries(Object.entries(value).map(([view, choice]) => [view, { ...choice }])) }

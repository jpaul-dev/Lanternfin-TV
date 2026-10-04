export const HOME_ROWS = { continue: 'Continue watching', watchlist: 'Watchlist', recent: 'Recently watched', favorites: 'Your favorites', live: 'Live TV', 'new-movies': 'Recently added movies', 'new-series': 'Recently added series', movies: 'Movies', series: 'Series & episodes' } as const
export type HomeRow = keyof typeof HOME_ROWS
export const DEFAULT_HOME_ROWS = Object.keys(HOME_ROWS) as HomeRow[]
export function normalizeHomeRows(value: unknown): HomeRow[] {
  if (!Array.isArray(value) || value.length > DEFAULT_HOME_ROWS.length || value.some(id => typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(HOME_ROWS, id)) || new Set(value).size !== value.length) return [...DEFAULT_HOME_ROWS]
  return [...value] as HomeRow[]
}


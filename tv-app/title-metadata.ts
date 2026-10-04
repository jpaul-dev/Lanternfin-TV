/** Bounded provider facts. Ratings are normalized to ten; missing data stays missing. */
export function titleRating(value: unknown, fiveBased?: unknown): number | undefined {
  const number = (raw: unknown) => typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,2}(?:\.\d{1,6})?$/.test(raw.trim()) ? Number(raw) : NaN
  const ten = number(value), five = number(fiveBased)
  const rating = ten > 0 && ten <= 10 ? ten : five > 0 && five <= 5 ? five * 2 : NaN
  return Number.isFinite(rating) ? Math.round(rating * 10) / 10 : undefined
}
export function titleYear(value: unknown): string | undefined {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''
  return /^(?:18|19|20|21)\d{2}(?:-\d{2}-\d{2})?$/.test(text) ? text.slice(0, 4) : undefined
}
export function titleMetadata(value: { rating?: unknown; year?: unknown; categoryId?: unknown }) {
  const rating = titleRating(value.rating), year = titleYear(value.year)
  const categoryId = typeof value.categoryId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.categoryId) ? value.categoryId : undefined
  return { ...(rating !== undefined ? { rating } : {}), ...(year ? { year } : {}), ...(categoryId ? { categoryId } : {}) }
}

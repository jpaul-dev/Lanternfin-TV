/** Exact seeking accepts seconds, m:ss, or h:mm:ss, never partial/ambiguous input. */
export function parseCompanionTime(input: string): number | null {
  const value = input.trim()
  if (!/^\d{1,7}(?::\d{2}){0,2}$/.test(value)) return null
  const parts = value.split(":").map(Number)
  if (parts.slice(1).some(part => part >= 60)) return null
  const seconds = parts.reduce((total, part) => total * 60 + part, 0)
  return Number.isSafeInteger(seconds) && seconds <= 604800 ? seconds : null
}

export function boundedCompanionSeek(seconds: number, duration: number, seekable = true): number | null {
  if (!seekable || !Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return null
  return Math.min(duration, Math.max(0, seconds))
}

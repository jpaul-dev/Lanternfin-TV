/** Provider runtime is display metadata, never a replacement for the player's timeline. */
export function providerRuntime(seconds: unknown, clock?: unknown): number | undefined {
  const raw = typeof seconds === 'number' ? seconds : typeof seconds === 'string' && /^\d{1,6}(?:\.\d{1,3})?$/.test(seconds.trim()) ? Number(seconds) : NaN
  if (Number.isFinite(raw) && raw >= 1 && raw <= 604800) return Math.floor(raw)
  if (typeof clock !== 'string') return
  const parts = clock.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):([0-5]\d)$/)
  if (!parts || Number(parts[2]) > 59) return
  const value = Number(parts[1] || 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3])
  return value >= 1 && value <= 604800 ? value : undefined
}
export function runtimeLabel(seconds?: number): string {
  if (!seconds) return ''
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = String(seconds % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

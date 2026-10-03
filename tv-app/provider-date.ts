/** Provider epoch seconds or milliseconds. Never substitute a release or fetch date. */
export function providerTimestamp(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d{1,13}$/.test(value.trim()))) return
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return
  const milliseconds = number < 1e12 ? number * 1000 : number
  return catalogTimestamp(milliseconds, now)
}

/** Stored dates already use milliseconds; do not reinterpret small values. */
export function catalogTimestamp(value: unknown, now = Date.now()): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= now + 86400000) return value
}


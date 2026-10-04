/** Schedule correction is separate from the clock used to format labels. */
export type GuideCorrection = number | 'auto'
export function validGuideOffset(value: unknown): value is GuideCorrection {
  return value === 'auto' || typeof value === 'number' && Number.isInteger(value) && value >= -720 && value <= 840 && value % 30 === 0
}
export function guideOffset(value: unknown): GuideCorrection {
  if (value === undefined) return 0
  if (!validGuideOffset(value)) throw new Error('Choose Automatic or a guide correction from −12 to +14 hours in 30-minute steps.')
  return value
}
export function channelGuideShift(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 24 ? value * 60 : 0
}
export function guideOffsetLabel(minutes: GuideCorrection): string {
  if (minutes === 'auto') return 'Automatic · XMLTV estimate'
  return minutes ? `${minutes < 0 ? '−' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}` : 'No correction'
}

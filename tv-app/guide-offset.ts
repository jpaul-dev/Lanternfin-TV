/** Manual schedule correction is separate from the clock used to format labels. */
export function validGuideOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -720 && value <= 840 && value % 30 === 0
}
export function guideOffset(value: unknown): number {
  if (value === undefined) return 0
  if (!validGuideOffset(value)) throw new Error('Choose a guide correction from −12 to +14 hours in 30-minute steps.')
  return value
}
export function channelGuideShift(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 24 ? value * 60 : 0
}
export function guideOffsetLabel(minutes: number): string {
  return minutes ? `${minutes < 0 ? '−' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}` : 'No correction'
}

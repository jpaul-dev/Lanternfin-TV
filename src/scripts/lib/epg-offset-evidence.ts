/** Streaming equivalent of the full-schedule coverage heuristic in epg-data.js.
 * Keep candidate coverage bits, not 50 channels' descriptions/full schedules.
 */
export type OffsetEvidence = { channels: number; scores: number[]; explicit: boolean }
export type OffsetEstimate = { minutes: number; channels: number; reason: 'estimated' | 'explicit' | 'empty' }
const MIN = -720, MAX = 840, STEP = 30, CANDIDATES = (MAX - MIN) / STEP + 1
export class OffsetCoverage {
  private channels = new Map<string, Uint8Array>()
  constructor(private now: number) {}
  add(id: string, start: number, stop: number) {
    if (!id || id.length > 512 || !Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return
    let coverage = this.channels.get(id)
    if (!coverage) {
      if (this.channels.size === 50) return
      coverage = new Uint8Array(CANDIDATES); this.channels.set(id, coverage)
    }
    // start + shift <= now < stop + shift: stop is deliberately exclusive.
    const first = Math.max(0, Math.floor(((this.now - stop) / 60000 - MIN) / STEP) + 1)
    const last = Math.min(CANDIDATES - 1, Math.floor(((this.now - start) / 60000 - MIN) / STEP))
    for (let index = first; index <= last; index++) coverage[index] = 1
  }
  evidence(explicit: boolean): OffsetEvidence {
    const scores = Array<number>(CANDIDATES).fill(0)
    for (const coverage of this.channels.values()) for (let i = 0; i < CANDIDATES; i++) scores[i] += coverage[i]
    return { channels: this.channels.size, scores, explicit }
  }
}
export function estimateOffset(evidence?: OffsetEvidence, preferred?: number): OffsetEstimate {
  const empty: OffsetEstimate = { minutes: 0, channels: 0, reason: 'empty' }
  if (!evidence || typeof evidence.explicit !== 'boolean' || !Number.isInteger(evidence.channels) || evidence.channels < 1 || evidence.channels > 50 || !Array.isArray(evidence.scores) || evidence.scores.length !== CANDIDATES || evidence.scores.some(score => !Number.isInteger(score) || score < 0 || score > evidence.channels)) return empty
  if (evidence.explicit) return { ...empty, channels: evidence.channels, reason: 'explicit' }
  let minutes = 0, best = -1
  for (let i = 0; i < CANDIDATES; i++) {
    const offset = MIN + i * STEP, score = evidence.scores[i]
    if (score > best || score === best && Math.abs(offset) < Math.abs(minutes)) { best = score; minutes = offset }
  }
  if (best <= 0) return { ...empty, channels: evidence.channels }
  // Preserve the original two-channel hysteresis when refreshing a source.
  if (preferred !== undefined && Number.isInteger(preferred) && preferred >= MIN && preferred <= MAX && preferred % STEP === 0 && best < evidence.scores[(preferred - MIN) / STEP] + 2) minutes = preferred
  return { minutes, channels: evidence.channels, reason: 'estimated' }
}

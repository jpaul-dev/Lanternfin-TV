// Shared constants for epg-data.js and epg-worker.ts - kept side-effect-free
// so the worker (which has no DOM) can import it safely.
export const EPG_PAST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Bounded per-channel extraction of a selected day, including corrected raw timestamps. */
export function boundedEpgWindow(window: { fromMs: number; toMs: number }, now = Date.now()) {
  if (!Number.isFinite(window.fromMs) || !Number.isFinite(window.toMs) || window.fromMs >= window.toMs) throw new Error("Invalid programme guide time window.")
  const day = 24 * 60 * 60 * 1000
  // Seven past calendar days / two future days, with room for clock-zone day
  // boundaries and combined source (+14h) and channel (+24h) correction.
  return { fromMs: Math.max(now - 10 * day, window.fromMs), toMs: Math.min(now + 7 * day, window.toMs) }
}

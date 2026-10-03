export const ACCENTS = { fuchsia: ['#e68bdf', '#96368f'], rose: ['#ffa0b9', '#a82b50'], ember: ['#ffba86', '#9f480b'], emerald: ['#7cddba', '#126448'], cyan: ['#82dce7', '#086876'], blue: ['#98bcff', '#285eac'], violet: ['#bdabff', '#6743b9'], gold: ['#f2d279', '#795b00'], lime: ['#c4df85', '#536f09'], teal: ['#8dddd0', '#106a5c'], silver: ['#c3ccd6', '#566473'], white: ['#f4f6f8', '#343e49'] } as const
export type Accent = keyof typeof ACCENTS
export type AccentChoice = Accent | 'random'
const KEY = 'lanternfin.tv.accent-roll.v1'
let fallback: Accent | undefined
let ignoreSaved = false
const storage = () => { try { return sessionStorage } catch { return null } }
export const isAccent = (value: unknown): value is Accent => typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACCENTS, value)
export function sourceAccent(value: unknown): Accent | undefined {
  if (value === undefined || value === '') return
  if (!isAccent(value)) throw new Error('Choose a listed source color or App default.')
  return value
}
/** Match Android's one random preset per session, including reloads where storage works. */
export function resolveAccent(choice: AccentChoice, session = storage()): Accent {
  if (choice !== 'random') return choice
  if (fallback) return fallback
  try { const saved = !ignoreSaved && session?.getItem(KEY); if (isAccent(saved)) return fallback = saved } catch { /* Keep a stable in-memory roll. */ }
  const colors = Object.keys(ACCENTS) as Accent[]
  if (!fallback) fallback = colors[Math.floor(Math.random() * colors.length)]
  try { if (session) { session.setItem(KEY, fallback); ignoreSaved = false } } catch { /* Session-only appearance remains usable. */ }
  return fallback
}
export function clearAccentRoll(session = storage()) { fallback = undefined; ignoreSaved = true; try { session?.removeItem(KEY) } catch { /* A session that cannot write can still use the in-memory roll. */ } }

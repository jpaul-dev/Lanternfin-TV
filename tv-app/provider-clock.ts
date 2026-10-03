import { computeServerOffsetMs } from '../src/scripts/lib/catchup'

type ServerClock = { time_now?: unknown; timestamp_now?: unknown; timezone?: unknown }
const validOffset = (value: number) => Number.isFinite(value) && value >= -720 && value <= 840
/** Uses numeric date parts instead of newer longOffset formatting absent on some TV engines. */
function zoneOffset(zone: unknown, at: number): number | undefined {
  if (typeof zone !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,79}$/.test(zone) || !Number.isFinite(at)) return
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const part = (name: string) => Number(parts.find(part => part.type === name)?.value)
    const hour = part('hour'); if (hour < 0 || hour > 24) return
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), hour % 24, part('minute'), part('second'))
    const offset = (wall - Math.floor(at / 1000) * 1000) / 60000
    if (validOffset(offset)) return offset
  } catch { /* Unknown IANA zone or insufficient Intl support; never silently choose UTC. */ }
}
export function providerClockOffset(info: ServerClock | undefined, programmeStart: number): number {
  const missing = () => new Error('The provider did not report its clock. Choose its UTC offset below and retry.')
  if (!info) throw missing()
  const match = typeof info.time_now === 'string' && info.time_now.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  const timestamp = typeof info.timestamp_now === 'number' || typeof info.timestamp_now === 'string' && /^\d+(?:\.\d+)?$/.test(info.timestamp_now) ? Number(info.timestamp_now) : NaN
  if (match && Number.isFinite(timestamp) && timestamp >= 946684800 && timestamp <= 4133980800) {
    const parts = match.slice(1).map(Number), date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
    const roundTrip = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    if (!parts.every((value, index) => value === roundTrip[index])) throw missing()
    const offset = computeServerOffsetMs({ time_now: info.time_now as string, timestamp_now: timestamp }) / 60000
    if (!validOffset(offset)) throw missing()
    // Honor an explicit provider clock if its timezone disagrees. When the two
    // agree, evaluate the named zone at the programme to handle a DST boundary.
    const nowOffset = zoneOffset(info.timezone, timestamp * 1000), thenOffset = zoneOffset(info.timezone, programmeStart)
    return nowOffset === offset && thenOffset !== undefined ? thenOffset : offset
  }
  const offset = zoneOffset(info.timezone, programmeStart)
  if (offset === undefined) throw missing()
  return offset
}

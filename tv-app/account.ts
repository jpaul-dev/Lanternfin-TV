import type { Source } from './catalog'
import { request } from './xtream'
export type AccountStatus = { accepted: boolean; status: string; expires?: number; connections?: number; maximum?: number; trial: boolean; timezone?: string; formats: string[] }
export async function loadAccount(source: Source, signal: AbortSignal): Promise<AccountStatus> {
  const data = await request(source, '', signal, {}, 256 * 1024) as { user_info?: Record<string, unknown>; server_info?: Record<string, unknown> } | null
  const info = data?.user_info
  if (!info || typeof info !== 'object' || !['0', '1'].includes(String(info.auth))) throw new Error('This provider does not expose account status.')
  const number = (value: unknown, max: number) => typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max ? Number(value) : undefined : undefined
  const expires = number(info.exp_date, 253402300799), timezone = data?.server_info?.timezone
  return { accepted: String(info.auth) === '1', status: ['Active', 'Expired', 'Disabled', 'Banned'].includes(String(info.status)) ? String(info.status) : 'Not reported', ...(expires ? { expires: expires * 1000 } : {}), connections: number(info.active_cons, 100000), maximum: number(info.max_connections, 100000), trial: String(info.is_trial) === '1', timezone: typeof timezone === 'string' ? timezone.slice(0, 80) : undefined, formats: Array.isArray(info.allowed_output_formats) ? info.allowed_output_formats.filter((item): item is string => typeof item === 'string' && /^[a-zA-Z0-9]{1,16}$/.test(item)).slice(0, 12) : [] }
}

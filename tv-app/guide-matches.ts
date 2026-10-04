export const MAX_GUIDE_MATCHES = 1000
export const validGuideId = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
export function readGuideMatches(value: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(value) || value.length > MAX_GUIDE_MATCHES) return
  const result: Array<[string, string]> = [], seen = new Set<string>()
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !/^[a-f0-9]{16}$/.test(row[0]) || seen.has(row[0]) || !validGuideId(row[1])) return
    seen.add(row[0]); result.push([row[0], row[1].toLowerCase()])
  }
  return result
}

/** Android's conservative name rules, without its desktop storage/network imports. */
export function guideName(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(?:\b|[\s_.-])(hd|fhd|uhd|4k|sd|hevc|h\.?26[45]|hq|sd1|hd1)(?=\b|[\s_.-]|$)/gi, ' ').replace(/[^\p{L}\p{N}+]+/gu, '')
}
export function guideNameIndex(channels: Iterable<[string, string]>) {
  const names = new Map<string, string>()
  for (const [id, label] of channels) {
    const name = guideName(label)
    if (name) names.set(name, names.has(name) && names.get(name) !== id ? '' : id)
  }
  return names
}

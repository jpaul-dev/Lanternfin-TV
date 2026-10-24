// The wire format is shared by the browser, Android shell, TV ports and server.
// IDs are lookup keys, not credentials or authentication tokens.
export function sourceKey(source) {
  const url = new URL(source.type === 'xtream' ? source.serverUrl : source.url)
  url.hash = ''
  if (source.type === 'xtream') url.pathname = url.pathname.replace(/\/+$/, '')
  const identity = JSON.stringify([source.type, url.href.replace(/\/$/, ''), source.type === 'xtream' ? source.username : ''])
  let a = 2166136261, b = 5381
  for (let i = 0; i < identity.length; i++) { const c = identity.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

const text = (v, max) => typeof v === 'string' && v.length <= max
const http = v => { try { const u = new URL(v); return text(v, 8192) && /^https?:$/.test(u.protocol) && !u.username && !u.password } catch { return false } }
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 315360000
export function validateHomeRow(key, value) {
  if (typeof key !== 'string' || key.length > 180 || !/^(source\/[a-f0-9]{16}|progress\/[a-f0-9]{16}\/(vod|episode)\/[A-Za-z0-9_-]{1,80})$/.test(key)) throw new Error('Invalid shared record.')
  if (value === null) return null // tombstones prevent an offline device resurrecting a deletion
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shared value.')
  if (key.startsWith('source/')) {
    if (!['xtream', 'm3u'].includes(value.type) || !text(value.title, 200)) throw new Error('Share an Xtream account or online M3U playlist.')
    const source = { type: value.type, title: value.title }
    if (value.type === 'xtream') {
      if (!http(value.serverUrl) || !text(value.username, 256) || !value.username || !text(value.password, 1024) || !value.password) throw new Error('Invalid account.')
      Object.assign(source, { serverUrl: value.serverUrl.replace(/\/+$/, ''), username: value.username, password: value.password, liveContainer: value.liveContainer === 'ts' ? 'ts' : 'm3u8' })
      if (Array.isArray(value.mirrors)) source.mirrors = value.mirrors.slice(0, 10).map(m => {
        if (!http(m.serverUrl) || !text(m.username, 256) || !text(m.password, 1024)) throw new Error('Invalid backup server.')
        return { serverUrl: m.serverUrl, username: m.username, password: m.password }
      })
    } else { if (!http(value.url)) throw new Error('Invalid playlist address.'); source.url = value.url }
    if (value.epgUrl) { if (!http(value.epgUrl)) throw new Error('Invalid guide address.'); source.epgUrl = value.epgUrl }
    if (Array.isArray(value.additionalEpgUrls)) { if (value.additionalEpgUrls.length > 10 || !value.additionalEpgUrls.every(http)) throw new Error('Invalid guide addresses.'); source.additionalEpgUrls = value.additionalEpgUrls }
    if (value.disableProviderEpg === true) source.disableProviderEpg = true
    if (key !== `source/${sourceKey(source)}`) throw new Error('Account identity mismatch.')
    return source
  }
  if (!number(value.position) || !number(value.duration) || typeof value.completed !== 'boolean') throw new Error('Invalid playback position.')
  const progress = { position: value.position, duration: value.duration, completed: value.completed }
  for (const field of ['name', 'logo', 'episodeTitle', 'seriesName', 'seriesLogo', 'extension', 'season', 'episodeNum', 'seriesId']) {
    const item = value[field]
    if (typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 || text(item, field.includes('ogo') ? 2048 : 200)) progress[field] = item
  }
  return progress
}

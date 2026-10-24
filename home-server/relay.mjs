import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const allowedHeaders = /^(accept|accept-language|authorization|content-type|range|user-agent|referer|origin|x-[a-z0-9-]+)$/i
export function mediaPath(raw, context) { const u = new URL(raw); const prefix = context ? `~${Buffer.from(JSON.stringify(context)).toString('base64url')}/` : ''; return `/_home/media/${prefix}${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}` }
export function mediaRequest(path) {
  const match = path.match(/^\/_home\/media\/(?:~([A-Za-z0-9_-]{1,16000})\/)?(https?)\/([^/]+)(\/.*)$/)
  if (!match) throw new Error('Invalid stream address.')
  const url = `${match[2]}://${match[3]}${match[4]}`
  const context = match[1] ? JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) : undefined
  const headers = {}
  if (context?.headers && typeof context.origin === 'string') {
    const sameOrigin = new URL(url).origin === context.origin
    for (const [key, value] of Object.entries(context.headers)) if (key.toLowerCase() === 'user-agent' || sameOrigin && ['authorization', 'referer', 'origin'].includes(key.toLowerCase())) headers[key] = value
  }
  return { url, context, headers }
}
export function mediaTarget(path) { return mediaRequest(path).url }
export function safeTargetAddress(address) {
  // Loopback, link-local/metadata, multicast and unspecified destinations are not providers.
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && parts[0] !== 0 && parts[0] !== 127 && parts[0] < 224 && !(parts[0] === 169 && parts[1] === 254) && address !== '100.100.100.200'
}
export async function upstream(raw, init = {}, hops = 0, blocked = []) {
  const u = new URL(raw)
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || raw.length > 16384 || hops > 5) throw new Error('Invalid provider address or too many redirects.')
  const resolved = await lookup(u.hostname, { family: 4 })
  if (!safeTargetAddress(resolved.address) || blocked.includes(`${resolved.address}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`)) throw new Error('This destination is not a provider address.')
  const headers = { 'accept-encoding': 'identity', 'user-agent': 'Mozilla/5.0 Lanternfin/0.1' }
  for (const [name, value] of Object.entries(init.headers || {})) if (allowedHeaders.test(name) && typeof value === 'string' && value.length <= 8192 && !/[\r\n]/.test(value)) headers[name.toLowerCase()] = value
  const response = await new Promise((resolve, reject) => {
    const request = (u.protocol === 'https:' ? https : http).request(u, {
      method: init.method || 'GET', headers, signal: init.signal,
      // Pin the checked DNS address, including for each redirect.
      lookup: (_host, options, callback) => callback(null, options.all ? [resolved] : resolved.address, resolved.family),
    }, resolve)
    request.setTimeout(45000, () => request.destroy(new Error('Provider timed out.')))
    request.on('error', reject)
    request.end(init.body || undefined)
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    response.destroy()
    const target = new URL(response.headers.location, u)
    if (target.origin !== u.origin) { delete headers.authorization; delete headers.referer; delete headers.origin }
    return upstream(target.href, { ...init, headers, ...(response.statusCode === 303 ? { method: 'GET', body: undefined } : {}) }, hops + 1, blocked)
  }
  return { response, url: u.href }
}
async function boundedText(stream) {
  let bytes = 0; const chunks = []
  for await (const chunk of stream) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { stream.destroy(); throw new Error('Manifest is too large.'); } chunks.push(chunk) }
  return Buffer.concat(chunks).toString('utf8')
}
export function rewriteHls(text, base, context) {
  const address = value => { if (/^(data:|skd:)/i.test(value)) return value; return mediaPath(new URL(value, base).href, context) }
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => {
    if (!line.trim()) return line
    if (!line.startsWith('#')) return address(line.trim())
    return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${address(uri)}"`)
  }).join('\n')
}
export function rewriteDash(text, base, context) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported manifest declaration.')
  const doc = new DOMParser({ onError: level => { if (level !== 'warning') throw new Error('Invalid DASH manifest.') } }).parseFromString(text, 'application/xml')
  if (doc.documentElement.localName !== 'MPD') throw new Error('Invalid DASH manifest.')
  // A root BaseURL preserves relative segment templates. Existing absolute bases,
  // templates, locations and xlinks also stay on the authenticated local relay.
  const rootBase = doc.createElementNS(doc.documentElement.namespaceURI, 'BaseURL')
  rootBase.textContent = base
  if (![...Array.from(doc.documentElement.childNodes)].some(n => n.nodeType === 1 && n.localName === 'BaseURL')) doc.documentElement.insertBefore(rootBase, doc.documentElement.firstChild)
  const absolute = value => /^https?:\/\//i.test(value) || value.startsWith('//') || value.startsWith('/')
  function visit(node, parentBase) {
    let currentBase = parentBase
    const bases = Array.from(node.childNodes || []).filter(n => n.nodeType === 1 && n.localName === 'BaseURL')
    if (bases.length) currentBase = new URL(bases[0].textContent.trim(), parentBase).href
    for (const child of bases) child.textContent = mediaPath(new URL(child.textContent.trim(), parentBase).href, context)
    for (const attr of Array.from(node.attributes || [])) {
      if (['media', 'initialization', 'sourceURL', 'href'].includes(attr.localName) && absolute(attr.value)) attr.value = mediaPath(new URL(attr.value, currentBase).href, context)
    }
    for (const child of Array.from(node.childNodes || [])) if (child.nodeType === 1 && child.localName !== 'BaseURL') {
      if (['Location', 'PatchLocation'].includes(child.localName)) child.textContent = mediaPath(new URL(child.textContent.trim(), currentBase).href, context)
      else visit(child, currentBase)
    }
  }
  visit(doc.documentElement, base)
  return new XMLSerializer().serializeToString(doc)
}
export async function relay(req, res, target, init, media, blocked, context) {
  const abort = new AbortController()
  res.on('close', () => abort.abort())
  const { response, url } = await upstream(target, { ...init, signal: abort.signal }, 0, blocked)
  let type = String(response.headers['content-type'] || 'application/octet-stream')
  // Do not execute a provider's HTML/SVG in the trusted household origin.
  if (/text\/html|image\/svg|javascript/i.test(type)) type = 'text/plain; charset=utf-8'
  res.statusCode = response.statusCode || 502
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
  for (const name of ['accept-ranges', 'content-range']) if (response.headers[name]) res.setHeader(name, response.headers[name])
  const hls = /mpegurl/i.test(type) || /\.m3u8(?:\?|$)/i.test(url)
  const dash = /dash\+xml/i.test(type) || /\.mpd(?:\?|$)/i.test(url)
  if (media && req.method !== 'HEAD' && response.statusCode === 200 && (hls || dash)) {
    const encoding = response.headers['content-encoding']
    const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null
    if (decoder) response.on('error', error => decoder.destroy(error))
    let text
    try { text = await boundedText(decoder ? response.pipe(decoder) : response) } finally { response.destroy() }
    res.end(hls ? rewriteHls(text, url, context) : rewriteDash(text, url, context))
  } else {
    if (response.headers['content-encoding']) res.setHeader('Content-Encoding', response.headers['content-encoding'])
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length'])
    await pipeline(response, res)
  }
}

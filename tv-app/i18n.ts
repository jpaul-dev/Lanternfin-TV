/** Original community translations, without desktop storage or services. */
export const INTERFACE_LANGUAGES = { auto: 'Use device language', en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', 'pt-BR': 'Português (Brasil)', it: 'Italiano', ru: 'Русский', zh: '中文（简体）', ja: '日本語', tr: 'Türkçe', ar: 'العربية', ur: 'اردو', nl: 'Nederlands', hi: 'हिन्दी', id: 'Bahasa Indonesia', pl: 'Polski' } as const
type Messages = Record<string, string>
declare global { interface Window { LanternfinTranslations?: Record<string, Messages> } }
let messages: Messages = {}, active = 'en', generation = 0
const loads = new Map<string, Promise<Messages>>()
export function localeCode(value: string, device = navigator.language) {
  const requested = value === 'auto' ? device : value
  return Object.keys(INTERFACE_LANGUAGES).find(code => code !== 'auto' && code.toLowerCase() === requested.toLowerCase()) || Object.keys(INTERFACE_LANGUAGES).find(code => code !== 'auto' && code.split('-')[0] === requested.toLowerCase().split('-')[0]) || 'en'
}
export function interfaceLocale() { return active }
export function tr(text: string, parameters?: Record<string, string | number>) {
  const decorated = text.match(/^([★☆▶←✓↶]\s*)(.+)$/), key = decorated?.[2] || text
  const translated = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key
  const value = (decorated?.[1] || '') + translated
  return parameters ? value.replace(/\{(\w+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : token) : value
}
export function loadMessages(code: string): Promise<Messages> {
  if (code === 'en') return Promise.resolve({})
  if (!Object.prototype.hasOwnProperty.call(INTERFACE_LANGUAGES, code) || code === 'auto') return Promise.reject(new Error('Unsupported interface language.'))
  let pending = loads.get(code)
  if (!pending) {
    pending = new Promise<Messages>((resolve, reject) => {
      const script = document.createElement('script'); script.src = `locale-${code}.js`
      const done = (error = false) => { clearTimeout(timer); script.remove(); const value = window.LanternfinTranslations?.[code]; error || !value ? reject(new Error('The language file could not be loaded. Reinstall the complete app package.')) : resolve(value) }
      const timer = setTimeout(() => done(true), 5000)
      script.onload = () => done(); script.onerror = () => done(true); document.head.append(script)
    }).catch(error => { loads.delete(code); throw error })
    loads.set(code, pending)
  }
  return pending
}
export async function setInterfaceLanguage(value: string, loader = loadMessages) {
  const code = localeCode(value), token = ++generation
  let next: Messages
  try { next = await loader(code) } catch (error) { if (token !== generation) return false; throw error }
  if (token !== generation) return false
  messages = next; active = code; document.documentElement.lang = code
  document.documentElement.dir = ['ar', 'ur'].includes(code) ? 'rtl' : 'ltr'
  return true
}
/** Remember only explicitly supplied UI copy, never arbitrary provider text. */
export function translatedText(node: HTMLElement) {
  let source = '', parameters: Record<string, string | number> | undefined
  const refresh = () => { node.textContent = tr(source, parameters) }
  return {
    set(text: string, values?: Record<string, string | number>) { source = text; parameters = values ? { ...values } : undefined; refresh() },
    refresh,
    get source() { return source },
  }
}
/** Capture shipped static nodes once, before any provider data is rendered. */
export function staticTranslations(root: HTMLElement) {
  const texts: { node: Text; source: string; before: string; after: string }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest('script,style,textarea')) continue
    const source = node.data.trim(); if (source) texts.push({ node, source, before: node.data.match(/^\s*/)?.[0] || '', after: node.data.match(/\s*$/)?.[0] || '' })
  }
  const attributes: { node: Element; name: string; source: string; last: string }[] = []
  for (const node of root.querySelectorAll('[aria-label],[placeholder],[title]')) for (const name of ['aria-label', 'placeholder', 'title']) { const source = node.getAttribute(name); if (source) attributes.push({ node, name, source, last: source }) }
  return () => {
    for (const { node, source, before, after } of texts) if (node.isConnected) node.data = before + tr(source) + after
    for (const entry of attributes) if (entry.node.isConnected && entry.node.getAttribute(entry.name) === entry.last) { entry.last = tr(entry.source); entry.node.setAttribute(entry.name, entry.last) }
  }
}

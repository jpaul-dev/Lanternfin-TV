// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { installTVCompatibility } from '../tv-app/compatibility'

const native = Object.getOwnPropertyDescriptor(Element.prototype, 'replaceChildren')!
afterEach(() => { Object.defineProperty(Element.prototype, 'replaceChildren', native); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers() })

it('fills only the absent DOM method, preserving nodes, fragments, order and inert strings', () => {
  installTVCompatibility(); expect(Element.prototype.replaceChildren).toBe(native.value)
  delete (Element.prototype as Partial<Element>).replaceChildren
  installTVCompatibility()
  const parent = document.createElement('div'), first = document.createElement('button'), fragment = document.createDocumentFragment(), second = document.createElement('span')
  parent.append(first); fragment.append(second); document.body.append(parent)
  const click = vi.fn(); first.onclick = click
  parent.replaceChildren('prefix', first, fragment, '<img src=x onerror=bad()>')
  expect([...parent.childNodes]).toEqual([expect.any(Text), first, second, expect.any(Text)])
  expect(parent.textContent).toBe('prefix<img src=x onerror=bad()>'); expect(parent.querySelector('img')).toBeNull()
  first.click(); expect(click).toHaveBeenCalledOnce()
  expect(() => parent.replaceChildren(document.body)).toThrow(); expect(parent.contains(first)).toBe(true)
  parent.replaceChildren(); expect(parent.childNodes).toHaveLength(0)
})

it('keeps local app assets permitted in both policies without enabling remote or inline scripts', () => {
  const html = readFileSync('tv-app/index.html', 'utf8'), config = readFileSync('tv-app/platforms/tizen/config.xml', 'utf8')
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]
  expect(config).toContain(`<tizen:content-security-policy>${policy}</tizen:content-security-policy>`)
  for (const kind of ['style', 'font', 'img', 'worker']) expect(policy.split(';').find(part => part.trim().startsWith(`${kind}-src`))).toContain('file:')
  expect(policy.split(';').find(part => part.trim().startsWith('script-src'))?.trim()).toBe("script-src 'self' file:")
  expect(policy).not.toContain('unsafe-inline'); expect(policy).not.toContain('unsafe-eval')
})

it('shows a safe readable startup failure, but leaves a healthy app alone', () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="startup-status" hidden></div><main id="app"></main>'
  document.documentElement.removeAttribute('data-app-ready')
  const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => 'ready' } as unknown as CSSStyleDeclaration)
  const handlers: [string, EventListener][] = []
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => { handlers.push([type, listener as EventListener]) })
  window.eval(readFileSync('tv-app/startup.js', 'utf8'))
  handlers.find(([type]) => type === 'load')![1](new Event('load')); vi.advanceTimersByTime(5000)
  const panel = document.getElementById('startup-status')!, app = document.getElementById('app')!
  expect(panel.hidden).toBe(false); expect(panel.textContent).toContain('could not finish starting'); expect(panel.style.color).toBe('rgb(255, 255, 255)'); expect(app.hidden).toBe(true)
  panel.hidden = true; app.hidden = false; document.documentElement.setAttribute('data-app-ready', 'true')
  handlers.find(([type]) => type === 'lanternfin-ready')![1](new Event('lanternfin-ready'))
  expect(panel.hidden).toBe(true); expect(app.hidden).toBe(false)
  computed.mockReturnValue({ getPropertyValue: () => '' } as unknown as CSSStyleDeclaration)
  handlers.find(([type]) => type === 'lanternfin-ready')![1](new Event('lanternfin-ready'))
  expect(panel.textContent).toContain('stylesheet did not load'); expect(panel.textContent).not.toContain('https:')
})

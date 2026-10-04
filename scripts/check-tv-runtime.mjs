import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'acorn'
import { JSDOM } from 'jsdom'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function checkTVRuntime(target) {
  const dir = resolve(root, 'dist/tv', target)
  const manifest = JSON.parse(await readFile(resolve(dir, 'build.json'), 'utf8'))
  // A conservative syntax ceiling for Chromium 79. Check the actual artifacts,
  // including lazy-loaded engines/workers, rather than just the compiler setting.
  for (const file of Object.keys(manifest.hashes).filter(name => name.endsWith('.js'))) {
    try { parse(await readFile(resolve(dir, file), 'utf8'), { ecmaVersion: 2019, sourceType: 'script' }) }
    catch (error) { throw new Error(`${target}/${file} exceeds the TV syntax baseline: ${error.message}`) }
  }
  const dom = new JSDOM(await readFile(resolve(dir, 'index.html'), 'utf8'), { url: 'https://tv-test.invalid/', runScripts: 'outside-only' })
  try {
    const win = dom.window
    win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder
    delete win.Element.prototype.replaceChildren
    // No resource loading or provider requests: exercise packaged startup, icons,
    // setup, remote handlers and the actual API fallback in an isolated DOM.
    win.eval(await readFile(resolve(dir, 'app.js'), 'utf8'))
    await new Promise(resolve => win.setTimeout(resolve, 0))
    if (win.document.documentElement.getAttribute('data-app-ready') !== 'true') throw new Error('Startup did not finish')
    const kind = win.document.getElementById('source-kind')
    kind.value = 'xtream'; kind.dispatchEvent(new win.Event('change'))
    if (win.document.getElementById('login-fields').hidden) throw new Error('Source controls are not responding')
    win.document.getElementById('setup-diagnostics').click()
    if (win.document.getElementById('diagnostics').hidden) throw new Error('Diagnostics navigation did not open')
    await new Promise(resolve => win.setTimeout(resolve, 0))
    console.log(`${target}: ES2019 packaged syntax and C1 DOM startup checks passed`)
  } finally { dom.window.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const target of ['webos', 'tizen', 'browser']) await checkTVRuntime(target)
}

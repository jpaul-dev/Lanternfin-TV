import { build } from 'vite'
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!['webos', 'tizen', 'browser'].includes(target)) throw new Error('Usage: node scripts/build-tv.mjs webos|tizen|browser')
const out = resolve(root, 'dist', 'tv', target)
await mkdir(out, { recursive: true })
const result = await build({
  configFile: false, root, publicDir: false,
  define: { __TV_TARGET__: JSON.stringify(target) },
  build: {
    write: false, target: 'chrome85', cssTarget: 'chrome85', minify: true, sourcemap: false,
    lib: { entry: resolve(root, 'tv-app/app.ts'), name: 'LanternfinTV', formats: ['iife'] },
    rollupOptions: { output: { entryFileNames: 'app.js', assetFileNames: 'app.[ext]' } },
  },
})
for (const bundle of Array.isArray(result) ? result : [result]) {
  for (const output of bundle.output) await writeFile(resolve(out, output.fileName), output.type === 'chunk' ? output.code : output.source)
}
const html = (await readFile(resolve(root, 'tv-app/index.html'), 'utf8'))
  .replace('<!-- PLATFORM_SCRIPT -->', target === 'tizen' ? '<script src="$WEBAPIS/webapis/webapis.js"></script>' : '')
await writeFile(resolve(out, 'index.html'), html)
await copyFile(resolve(root, 'LICENSE'), resolve(out, 'LICENSE'))
await copyFile(resolve(root, 'tv-app/icons', target === 'webos' ? '80.png' : '117.png'), resolve(out, 'icon.png'))
if (target === 'webos') {
  await copyFile(resolve(root, 'tv-app/icons/130.png'), resolve(out, 'large-icon.png'))
  await copyFile(resolve(root, 'tv-app/platforms/webos/appinfo.json'), resolve(out, 'appinfo.json'))
}
if (target === 'tizen') await copyFile(resolve(root, 'tv-app/platforms/tizen/config.xml'), resolve(out, 'config.xml'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim()
await writeFile(resolve(out, 'NOTICE.txt'), `Lanternfin TV 0.1.0 TV preview\nAn independent GPL-3.0-or-later fork of Extreme InfiniTV by Ludovico Ferrara / infinitel8p and contributors.\nOriginal notice: Copyright (c) 2025 Ludovico Ferrara.\nShared M3U parser adapted from https://github.com/infinitel8p/Extreme-InfiniTV\nCorresponding source: https://github.com/jpaul-dev/Lanternfin-TV/tree/${commit}\nSource commit: ${commit}${dirty ? ' (working tree modifications; not a release build)' : ''}\nLicense: see LICENSE.\nNo media or subscriptions included. Experimental port; hardware validation pending.\n`)
const hashes = {}
for (const file of (await readdir(out)).sort()) if (file !== 'build.json') hashes[file] = createHash('sha256').update(await readFile(resolve(out, file))).digest('hex')
await writeFile(resolve(out, 'build.json'), JSON.stringify({ target, version: '0.1.0', commit, dirty, hashes }, null, 2) + '\n')
console.log(`Built ${target}: ${out}`)

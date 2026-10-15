import { build } from 'vite'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), out = resolve(root, 'pairing-service/dist')
await mkdir(out, { recursive: true })
const bundle = await build({ configFile: false, root, publicDir: false, build: { write: false, target: 'chrome79', minify: true, sourcemap: false, lib: { entry: resolve(root, 'pairing-service/phone/index.ts'), name: 'LanternfinPhone', formats: ['iife'] }, rollupOptions: { output: { entryFileNames: 'phone.js', assetFileNames: 'phone.[ext]' } } } })
for (const result of Array.isArray(bundle) ? bundle : [bundle]) for (const file of result.output) await writeFile(resolve(out, file.fileName), file.type === 'chunk' ? file.code : file.source)
await writeFile(resolve(out, 'index.html'), await readFile(resolve(root, 'pairing-service/phone/index.html')))
await copyFile(resolve(root, 'tv-setup/public/mark.svg'), resolve(out, 'mark.svg'))
await copyFile(resolve(root, 'LICENSE'), resolve(out, 'LICENSE.txt'))
console.log(`Built phone setup: ${out}`)

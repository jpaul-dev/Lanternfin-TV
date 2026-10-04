// Generates our own silent test video. Requires an existing FFmpeg executable; never downloads software or media.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts')
await mkdir(out, { recursive: true })
const english = resolve(out, 'mp4-fixture-en.srt'), french = resolve(out, 'mp4-fixture-fr.srt')
await writeFile(english, '1\n00:00:00,000 --> 00:00:12,000\nEmbedded MP4 captions\nEnglish track: opening\n\n2\n00:00:12,000 --> 00:00:35,000\nEmbedded MP4 captions\nEnglish track: middle\n\n3\n00:00:35,000 --> 00:00:55,000\nEmbedded MP4 captions\nEnglish track: approaching the end\n\n4\n00:01:00,000 --> 00:01:10,000\nEmbedded MP4 captions\nEnglish track: ending\n')
await writeFile(french, '1\n00:00:00,000 --> 00:01:10,000\nSous-titres MP4 integres\nPiste francaise\n')
execFileSync(process.argv[2] || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x202338:s=640x360:r=24:d=70', '-i', english, '-i', french, '-map', '0:v', '-map', '1:s', '-map', '2:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:1', 'language=fra', '-y', resolve(out, 'tv-mp4-text-demo.mp4')], { stdio: 'inherit', windowsHide: true, timeout: 120000 })
console.log('Generated artifacts/tv-mp4-text-demo.mp4; serve with the optional /_test/subtitled.mp4 preview fixture.')

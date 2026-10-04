// Our own silent video and captions. Uses an existing FFmpeg; downloads nothing.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts')
await mkdir(out, { recursive: true })
const english = resolve(out, 'mkv-fixture-en.srt'), french = resolve(out, 'mkv-fixture-fr.srt')
await writeFile(english, '1\n00:00:00,000 --> 00:00:12,000\nEmbedded MKV captions\nEnglish track: opening\n\n2\n00:00:12,000 --> 00:00:35,000\nEmbedded MKV captions\nEnglish track: middle\n\n3\n00:00:35,000 --> 00:00:55,000\nEmbedded MKV captions\nEnglish track: approaching the end\n\n4\n00:01:00,000 --> 00:01:10,000\nEmbedded MKV captions\nEnglish track: ending\n')
await writeFile(french, '1\n00:00:00,000 --> 00:01:10,000\nSous-titres MKV integres\nPiste francaise\n')
execFileSync(process.argv[2] || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x202338:s=640x360:r=24:d=70', '-i', english, '-i', french, '-map', '0:v', '-map', '1:s', '-map', '2:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English captions', '-metadata:s:s:1', 'language=fra', '-metadata:s:s:1', 'title=French captions', '-y', resolve(out, 'tv-mkv-text-demo.mkv')], { stdio: 'inherit', windowsHide: true, timeout: 120000 })
console.log('Generated artifacts/tv-mkv-text-demo.mkv; fixture preview URL: /_test/subtitled.mkv')

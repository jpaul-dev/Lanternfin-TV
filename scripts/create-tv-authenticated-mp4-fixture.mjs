// Generated test pattern and tones, no third-party media. Uses an existing FFmpeg installation.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/tv-authenticated-mp4.mp4')
execFileSync(process.argv[2] || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-t', '70', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '34', '-g', '48', '-bf', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k', '-ac', '1', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra', '-y', out], { stdio: 'inherit', windowsHide: true, timeout: 120000 })
console.log('Generated the 70-second tail-index MP4 test fixture; no video is included in TV packages.')

// Generates only our own test pattern/silent audio. Supply existing FFmpeg and
// Shaka Packager executables; nothing is downloaded or copied into TV packages.
import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { TEST_KID, TEST_KEY } from './tv-drm-fixture.mjs'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/tv-drm-demo')
await mkdir(out, { recursive: true })
const ffmpeg = process.argv[2] || 'ffmpeg', packager = process.argv[3] || 'packager'
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=90', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '90', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-bf', '0', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-y', resolve(out, 'clear.mp4')], { stdio: 'inherit', windowsHide: true, timeout: 120000 })
execFileSync(packager, ['in=clear.mp4,stream=video,init_segment=video-init.mp4,segment_template=video-$Number$.m4s,drm_label=DEMO', 'in=clear.mp4,stream=audio,init_segment=audio-init.mp4,segment_template=audio-$Number$.m4s,drm_label=DEMO', '--enable_raw_key_encryption', '--keys', `label=DEMO:key_id=${TEST_KID}:key=${TEST_KEY}`, '--clear_lead', '0', '--segment_duration', '4', '--generate_static_live_mpd', '--mpd_output', 'manifest.mpd'], { cwd: out, stdio: 'inherit', windowsHide: true, timeout: 120000 })
console.log('Generated a 90-second encrypted local test pattern. Use /_test/drm/playlist.m3u with the optional preview fixtures.')

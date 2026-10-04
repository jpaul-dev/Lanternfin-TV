# Authenticated progressive MP4 fixture

`tv-authenticated-mp4.mp4` contains 70 seconds of FFmpeg-generated `testsrc2` video and 220/440 Hz generated tones, labeled English/French for track-selection tests. It contains no downloaded, personal or provider media. The pattern is deliberately small (320×180, 24 fps), uses H.264 B-frames and two AAC tracks, and puts its `moov` index after the media.

Rebuild with an existing FFmpeg executable:

```text
node scripts/create-tv-authenticated-mp4-fixture.mjs <path-to-ffmpeg>
```

The generator downloads nothing. Encoder versions can change binary output; tests assert parsing/playback properties rather than an encoder-specific hash.

The optional local preview exposes this file only under `--fixtures`, requires the public test header `Authorization: fixture-only` and supports explicit byte ranges/CORS. The generated playlist includes a rejected-authorization case. No movie is included in the LG/Samsung application packages.

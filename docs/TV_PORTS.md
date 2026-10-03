# LG and Samsung preview ports

The first standalone TV port lives in `tv-app/`, on branch `ports/webos-tizen`. The Android baseline remains on `main`. Local checkout: `C:\Users\jayco\Desktop\Codex Projects\Lanternfin-TV`.

For a guided interface instead of terminal commands, open **Open TV Setup.vbs** in the checkout or the **Lanternfin TV Setup** desktop shortcut. See [the setup companion guide](TV_SETUP.md).

## What this preview does

- Opens your M3U playlist, an Xtream provider's `get.php` playlist, or a direct HTTP/HTTPS stream.
- Groups, searches, and pages through streams, with 24 cards per page. Incremental loading discards raw text and rich intermediate records, reports progress, and yields to the UI. Searches are cancellable. Resource guards are 256 MiB downloaded, 500,000 entries, 64 Mi characters of retained names/URLs/group strings, and 64 Ki characters per line; catalogs are never silently truncated. A 45-second inactivity timeout replaces the former 20-second total deadline.
- Uses HTML video on LG and Samsung AVPlay on Tizen; no phone, receiver service, or mandatory relay.
- Handles directional navigation, pointer clicks, Back, media keys, pause/resume, and basic VOD seeking. Stops playback when the app is hidden and requires an explicit selection to start again.
- Keeps provider settings in memory by default. Opt-in persistence uses unencrypted TV browser storage, with a Forget action. Turning Remember off removes the previously saved source.
- Includes original Lanternfin branding, original-project attribution, GPL license, source revision, and asset hashes in the packages.

This is a functional port foundation, **not Android feature parity or certified TV support**. Xtream support presently consumes the provider's M3U output; it is not the full movies/series API. No EPG, catch-up, resume history, favorites, subtitle/audio selection, DRM, custom HTTP headers, downloads, casting, transcoding, or app updater yet. Entries explicitly requiring DRM or custom headers are skipped with a count. Provider codec support remains a hardware question.

## Compatibility approach

Initial hardware target: **2022 and newer consumer TVs** (LG webOS 22 / Samsung Tizen 6.5 and newer), pending model/firmware tests. Older TVs, hospitality sets, signage, and store distribution are outside this first preview's claim.

The portable UI uses a classic bundled script, relative packaged resources, plain CSS, and a Chrome 85 compilation target. It imports the upstream pure M3U parser without importing Tauri, Android receiver code, Tailwind 4, or the desktop player stack. This avoids relying on the newer browser features used by the current Android/web UI. Engine versions are documented by [LG](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) and [Samsung](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

LG uses a packaged HTML application described by [appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json). Its Back key is handled explicitly, with our own exit confirmation as permitted by [LG's Back guidance](https://webostv.developer.lge.com/develop/guides/back-button). Native HLS/MP4 playback still needs tests against [LG's streaming specifications](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).

Samsung uses [AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html) with asynchronous preparation, a 1920×1080 native video plane, and stale-callback guards. Optional [media keys](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html) are registered individually. The Tizen manifest requests internet and TV input access only. `LantFin001.LanternfinTV` is a development application identifier, subject to store registration checks.

## Build and package

From the checkout, with Node 22+ and the pinned pnpm version:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
npm ci --prefix packaging/tv-tools --ignore-scripts --no-fund --no-audit
pnpm tv:check
pnpm test
pnpm tv:build
pnpm tv:package:webos
pnpm tv:package:tizen
```

Outputs:

| Output | Purpose |
| --- | --- |
| `dist/tv/webos/` | LG packaged app resources |
| `dist/tv/tizen/` | Samsung project resources, ready for the SDK signing step |
| `dist/tv/browser/` | Browser UI preview using HTML video |
| `artifacts/tv-preview-0.1.0/io.github.jpauldev.lanternfin_0.1.0_all.ipk` | LG developer installer, built by official LG CLI 3.2.6 |
| `artifacts/tv-preview-0.1.0/Lanternfin-TV-0.1.0-tizen-UNSIGNED.wgt` | Unsigned Samsung widget; **cannot be installed on a TV until signed** |
| `artifacts/tv-preview-0.1.0/*-SHA256SUMS.txt` | Package checksums |

`pnpm tv:preview` serves only the browser build at `http://127.0.0.1:4323`. For UI testing, `node scripts/preview-tv.mjs --fixtures` adds a local 50-entry test playlist at `/_test/playlist.m3u`; those entries deliberately return playback errors and are never included in either TV package.

The `LG and Samsung TV previews` GitHub workflow runs type checks, the complete unit suite, and packaging, then uploads both packages and app folders. It does not possess Samsung signing credentials. Builds record the source commit and whether the working tree was modified; distribute builds from a clean commit so the source link matches the package.

## Install on an LG development TV

1. Use LG's [Developer Mode app procedure](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), with your own developer account and TV on the same network. Developer sessions expire; this is not a store installation.
2. Register the actual TV with `ares-setup-device`, enable the TV key server, and obtain its development key using `ares-novacom --device <device-name> --getkey`.
3. Install and launch the IPK. With this repository's local CLI, the commands are:

```powershell
$aresPath = 'packaging/tv-tools/node_modules/@webos-tools/cli/bin'
node "$aresPath/ares-setup-device.js"
node "$aresPath/ares-novacom.js" --device YOUR_TV --getkey
node "$aresPath/ares-install.js" --device YOUR_TV artifacts/tv-preview-0.1.0/io.github.jpauldev.lanternfin_0.1.0_all.ipk
node "$aresPath/ares-launch.js" --device YOUR_TV io.github.jpauldev.lanternfin
```

Replace `YOUR_TV` with the device name you register. No TV was paired or installed during this implementation. The [LG CLI guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide) covers connection troubleshooting.

## Finish Samsung signing and installation

Samsung's TV SDK/CLI and certificate extension are required. They were not installed on this workstation during this implementation. A [Samsung TV certificate profile](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html) requires the developer account and target TV DUID. Keep the author certificate outside Git and back it up for future updates.

After creating a profile and connecting a TV in developer mode, use the [Samsung CLI procedure](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html):

```powershell
tizen build-web -- dist/tv/tizen
tizen package -t wgt -s YOUR_CERTIFICATE_PROFILE -- dist/tv/tizen/.buildResult
tizen install -t YOUR_TV -n LanternfinTV.wgt -- dist/tv/tizen/.buildResult
tizen run -t YOUR_TV -p LantFin001.LanternfinTV
```

Use the actual generated `.wgt` filename if the SDK chooses a different name. Do not try to install the `UNSIGNED.wgt` artifact directly. SDK compilation, signing, schema validation, and hardware installation remain unverified until that environment is available.

## Security and review notes

Provider data is rendered as text, never HTML. Only HTTP/HTTPS sources without URL user-info are accepted; scheme-less hosts default to HTTPS. No silent downgrade or certificate bypass. Catalog requests omit cookies and referrers, with cancellation, timeout, and streamed size limits. Network errors do not echo provider URLs/passwords. Source saving is explicit; it is **not encrypted**.

There is no public credential relay and no hard-coded service receiving provider credentials. Packaged network permissions allow arbitrary user-entered providers. JavaScript catalog access is still subject to each TV's origin/CORS/TLS rules; a playable direct stream does not prove a provider's playlist endpoint is fetchable. Start with providers that allow packaged-TV origins. If testing proves a relay is necessary, design an optional user-controlled one with strict destination rules and secret handling; never default to an anonymous public proxy.

The TV runtime bundle contains only this UI, the playback adapters, and the existing M3U parser. LG's official packaging CLI is isolated under `packaging/tv-tools`, installed with lifecycle scripts disabled, and never shipped to TVs. Its 3.2.6 distribution bundles old dependencies: the local audit found **8 affected dependency records (7 high, 1 moderate)**, including `braces`, `brace-expansion`, `js-yaml`, and `qs`. Normal npm overrides did not replace the bundled copies, so no ineffective override is claimed as a fix. The tool is currently used only on our fixed local app resources. This remains a build-tool risk to revisit before release. The earlier repository-wide findings in [the fork review](fork-review/README.md) also remain applicable to the broader project.

## Validation and next milestones

Verified source build: [`808fb81c5ce0780d6b83781c61866ac6b9f14c35`](https://github.com/jpaul-dev/Lanternfin-TV/tree/808fb81c5ce0780d6b83781c61866ac6b9f14c35). [GitHub Actions run 37095626858](https://github.com/jpaul-dev/Lanternfin-TV/actions/runs/37095626858) passed all **150 test files / 3,020 tests**, TV type checks, all three target builds, LG packaging, and unsigned Samsung packaging. This includes 30 new port tests. Browser inspection at 1280×720 confirmed setup and Xtream forms fit, source navigation reaches the Remember option, search and pagination work, markup in stream names stays inert, and Back restores focus after playback failure. All hashed assets inside both local packages matched the clean source build. A local Windows Defender scan with remediation disabled found no threats; this is not a guarantee of safety.

Original `808fb81` local package SHA-256 (the IPK built on CI may differ because the vendor archiver includes build timestamps). The setup companion subsequently rebuilt the LG package from `97e8c27`; see [its validation record](TV_SETUP.md#development-and-validation) and the checksum beside the current package. The original local packages are preserved under `artifacts/tv-preview-before-setup-97e8c27/`:

| Package | SHA-256 |
| --- | --- |
| LG IPK | `a7d72dcb4caebc036afb0c0fea48add935a94e57b2f104d285b464364e118a2a` |
| Samsung unsigned WGT | `ba2e4132492357161daa35e98102ef3a4dfba1b7fd6ddab07c855f609b76ceab` |

Automated coverage exercises URL and credential handling, malicious playlist text, relative stream paths and redirects, size limits without Content-Length, callback races, timeouts, stop/release, live versus VOD seeks, key mapping, and source persistence. Browser checks exercise layout, remote navigation, search, pagination, and failed-stream recovery. These checks do not emulate the vendor decoder or certify playback on a TV.

Before calling either port supported, record the TV model, OS version, firmware, remote type, and provider in a device test log. Test cold install/start, on-screen keyboard, all focus paths, both Back behaviors, home/resume, standby, failed login, CORS/TLS failures, expired URLs, repeated channel switching, H.264/AAC HLS, MP4 seeking, a 30-minute live stream, audio/video sync, and loss/recovery of the network. Test HTTP only when intentionally chosen; check that forgetting a source removes it after a cold start.

1. **Prove the platform foundations:** sign Samsung, install on one LG and one Samsung target, fix keyboard, native video-plane, lifecycle/screensaver and provider transport issues. This is the current acceptance gate.
2. **Expand the shared catalog:** extract pure Xtream category/movie/series/episode helpers from the Android code, add favorites and resume state, and preserve a common data contract across platforms.
3. **Add a TV guide and playback controls:** EPG cache with memory limits, audio/subtitle selection, then catch-up and format-specific fallbacks based on device evidence. Add one capability at a time to the hardware matrix.
4. **Prepare distribution:** settle the supported model years, resolve dependency findings, complete trademark/name checks and notices, privacy/store materials, accessibility tests, repeatable source publication and signing backups. Store submission is a separate milestone.

## Work toward everyday use

The 8 MiB / 30,000-entry prototype restriction has been removed. The first hardening checkpoint passed all 153 test files / 3,080 tests, including split UTF-8, cancellation of stalled reads, downloads lasting longer than the old deadline, line/response memory guards, and shared-parser regressions. A real browser loaded all 120,000 entries from a streamed synthetic playlist and located entry 120,000 by search. The synthetic fixture uses unavailable media URLs and validates catalog behavior, not playback. Run `node scripts/preview-tv.mjs --fixtures --port 4324` and load `http://127.0.0.1:4324/_test/large.m3u` to repeat it; this public test-data endpoint allows simulator origins.

The broader readiness goal remains active: add favorites and recent streams, resumable VOD and playback recovery, category-based Xtream live/movie/series browsing, program information, and a measured device acceptance pass. Passing the catalog checkpoint alone does not meet that goal.

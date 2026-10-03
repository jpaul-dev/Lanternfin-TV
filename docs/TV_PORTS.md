# LG and Samsung TV ports

The first standalone TV port lives in `tv-app/`, on branch `ports/webos-tizen`. The Android baseline remains on `main`. Local checkout: `C:\Users\jayco\Desktop\Codex Projects\Lanternfin-TV`.

For a guided interface instead of terminal commands, open **Open TV Setup.vbs** in the checkout or the **Lanternfin TV Setup** desktop shortcut. See [the setup companion guide](TV_SETUP.md).

## Current development build

- Opens M3U playlists, Xtream accounts, and direct HTTP/HTTPS streams. Xtream uses the category, live, movie, series and episode APIs, loading one category at a time. M3U remains available for provider compatibility.
- Groups, searches, and pages through streams, with 24 cards per page. Incremental loading discards raw text and rich intermediate records, reports progress, and yields to the UI. Searches are cancellable. Resource guards are 256 MiB downloaded, 500,000 entries, 64 Mi characters of retained names, URLs, groups, artwork and playback settings, and 64 Ki characters per line; catalogs are never silently truncated. A 45-second inactivity timeout replaces the former 20-second total deadline.
- Restores the original TV interface’s dark canvas, sidebar navigation, hero, artwork rows, poster grids, and focus treatment through portable components. Live TV, Movies, Series, Search, Favorites, Recent and Settings are separate views. This is an adaptation of the original UI, not complete feature parity.
- Bundles Shaka Player 5.2.8 for adaptive HLS/DASH and EME DRM. Samsung AVPlay handles compatible native streams and User-Agent/Cookie overrides. Plain direct files can use HTML video. No phone, receiver service, or mandatory relay.
- Handles directional navigation, pointer clicks, Back, media keys, pause/resume, and basic VOD seeking. Stops playback when the app is hidden and requires an explicit selection to start again.
- Adds favorites, the 100 most recently played streams, VOD resume prompts, library refresh, playback retry, and stalled-stream recovery. Library changes stay in memory unless source saving is enabled.
- Keeps provider settings in memory by default. Opt-in persistence uses unencrypted TV browser storage, with a Forget action. Turning Remember off removes the previously saved source.
- Includes original Lanternfin branding, original-project attribution, GPL license, source revision, and asset hashes in the packages.

This remains **development software, not Android feature parity or certified TV support**. EPG, catch-up, audio/subtitle selection, downloads, casting, transcoding and an app updater are pending. Xtream search currently searches the open category. Favorites/recent items remain available across category changes during a session; after restarting, their saved identifiers are matched as those categories are loaded again. Full cross-category indexing and metadata persistence remain work items.

### DRM and custom headers

The port preserves M3U `#KODIPROP` license settings, `#EXTVLCOPT` User-Agent/Referer settings, and URL-pipe headers. Protected/header-dependent entries are no longer discarded. Artwork and media kind are retained, with HTTP/HTTPS-only artwork and inert text rendering.

| Requirement | Current implementation and limit |
| --- | --- |
| HLS / DASH | Shaka, using MSE when available; native Samsung path for compatible unprotected streams |
| Widevine / PlayReady | Shaka EME configuration with provider license URL; requires a compatible CDM, codec and valid provider access; not yet verified on physical TVs |
| ClearKey | Explicit 32-character hexadecimal KID/key pairs passed to Shaka; not a DRM bypass |
| License authorization headers | Sent only on license requests, separate from media credentials |
| Media authorization headers | Sent on Shaka manifest/segment requests; provider must permit cross-origin requests. Direct MP4 header injection is unsupported on this path |
| User-Agent / Cookie | Samsung AVPlay native streaming properties; real-TV verification pending |
| Referer, Origin and other browser-controlled headers | Explicit unsupported message; never silently ignored. A provider-compatible URL or separately designed, opt-in local relay is needed |
| Kodi license payload/response transforms | Only raw challenge requests accepted; nontrivial transformations explicitly reported as unsupported |
| LG simulator | UI and unprotected playback only; LG documents no DRM or mediaOption support |

[Shaka’s platform matrix](https://github.com/shaka-project/shaka-player#platform-and-browser-support-matrix) includes Samsung; webOS is community supported. [Shaka’s DRM configuration](https://shaka-project.github.io/shaka-player/docs/api/tutorial-drm-config.html) and [license header guide](https://shaka-project.github.io/shaka-player/docs/api/tutorial-license-server-auth.html) describe the integration. [LG’s DRM matrix](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm) supports PlayReady and Widevine on real TVs, while the [simulator limitations](https://webostv.developer.lge.com/develop/tools/simulator-introduction) explicitly exclude DRM. Samsung’s [AVPlay reference](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html) documents the native streaming properties.

React and Next.js are presentation frameworks, not a solution to CDM, codec, CORS or forbidden-header limits. We retained the original project’s lightweight TypeScript interface approach and added Shaka as a playback adapter. A future component-framework migration should be justified by maintainability, not DRM support.

## Compatibility approach

Initial hardware target: **2022 and newer consumer TVs** (LG webOS 22 / Samsung Tizen 6.5 and newer), pending model/firmware tests. Older TVs, hospitality sets, signage, and store distribution are outside this first preview's claim.

The portable UI uses a classic bundled script, relative packaged resources, plain CSS, and a Chrome 85 compilation target. It imports the upstream pure M3U parser without importing Tauri, Android receiver code, Tailwind 4, or the desktop player stack. This avoids relying on the newer browser features used by the current Android/web UI. Engine versions are documented by [LG](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) and [Samsung](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

LG uses a packaged HTML application described by [appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json). Its Back key is handled explicitly, with our own exit confirmation as permitted by [LG's Back guidance](https://webostv.developer.lge.com/develop/guides/back-button). Native HLS/MP4 playback still needs tests against [LG's streaming specifications](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).

Samsung uses [AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html) with asynchronous preparation, a 1920×1080 native video plane, and stale-callback guards. Optional [media keys](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html) are registered individually. The Tizen manifest requests internet, TV input, and DRM playback access. The CSP permits provider artwork and media while keeping executable scripts local. `LantFin001.LanternfinTV` is a development application identifier, subject to store registration checks.

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
| `dist/tv/browser/` | Browser UI build with HTML video and Shaka |
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

The library checkpoint passed the full suite (154 files / 3,091 tests), followed by an additional application integration test covering favorites, resume prompts, failed-source recovery, refresh, and forgetting. Browser testing played MDN's public five-second MP4 and verified favorites and recent history survived a reload after explicit saving. VOD resume and decoder lifecycle are tested with controlled HTML/AVPlay doubles; real-TV seek behavior remains an acceptance item. Saved library records contain lookup identifiers and playback positions, not stream URLs; the separately opted-in source settings still contain provider credentials without encryption.


## UI and adaptive playback checkpoint

The rebuild restores sidebar navigation, an artwork hero, bounded home rails, poster grids, separate Live/Movie/Series browsing, and the original TV UI’s dark/pink visual treatment. The original Astro/Tailwind/desktop dependencies are not pulled into the packaged TV entry point. The small portable presentation module records its original UI sources for attribution.

Validation: the full suite passed 158 files / 3,106 tests at the first rebuild checkpoint. Browser testing successfully played Shaka’s public Angel One DASH sample. Mock-provider browsing verified movie categories, series artwork, and season/episode results. DRM configuration, media/license header isolation, invalid metadata, pending-load cancellation, and provider response limits have controlled tests; those tests do not establish TV DRM compatibility.

Build output for LG’s simulator remains `dist/tv/webos`. Reload that folder using the simulator’s app launcher; do not open the Android/Astro build. The packaged Shaka script and its Apache license, plus the bundled Geist font license, are included alongside the app.

For UI-only provider tests, run the preview server with `--fixtures --port 4324` and enter an Xtream account at `http://127.0.0.1:4324/_test/provider` with username/password `demo`. The generated artwork is labelled UI TEST LIBRARY and media URLs deliberately fail. These fixtures are not included in TV packages.

Remaining acceptance work: physical LG and Samsung DRM/license/codec/header matrix; persistent provider library indexing, full movie details and EPG; audio/subtitle controls; comparison against the original UI at each screen; extended remote navigation and playback soak tests. The broader readiness goal remains open.

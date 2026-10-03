# LG and Samsung TV ports

The first standalone TV port lives in `tv-app/`, on branch `ports/webos-tizen`. The Android baseline remains on `main`. Local checkout: `C:\Users\jayco\Desktop\Codex Projects\Lanternfin-TV`.

For a guided interface instead of terminal commands, open **Open TV Setup.vbs** in the checkout or the **Lanternfin TV Setup** desktop shortcut. See [the setup companion guide](TV_SETUP.md).

## Current development build

- Opens M3U playlists, Xtream accounts, and direct HTTP/HTTPS streams. Xtream uses the category, live, movie, series and episode APIs, loading categories sequentially into a bounded, cancellable whole-library index. M3U remains available for provider compatibility.
- Groups, searches, and pages through streams, with 24 cards per page. Incremental loading discards raw text and rich intermediate records, reports progress, and yields to the UI. Searches are cancellable. Resource guards are 256 MiB downloaded, 500,000 entries, 64 Mi characters of retained names, URLs, groups, artwork and playback settings, and 64 Ki characters per line; catalogs are never silently truncated. A 45-second inactivity timeout replaces the former 20-second total deadline.
- Restores the original TV interface’s dark canvas, sidebar navigation, hero, artwork rows, poster grids, and focus treatment through portable components. Live TV, Movies, Series, Search, Favorites, Recent and Settings are separate views. This is an adaptation of the original UI, not complete feature parity.
- Bundles Shaka Player 5.2.8 for adaptive HLS/DASH and EME DRM. Samsung AVPlay handles compatible native streams and User-Agent/Cookie overrides. Plain direct files can use HTML video. No phone, receiver service, or mandatory relay.
- Handles directional navigation, pointer clicks, Back, media keys, pause/resume, and basic VOD seeking. Stops playback when the app is hidden and requires an explicit selection to start again.
- Adds favorites, the 100 most recently played streams, VOD resume prompts, library refresh, playback retry, and stalled-stream recovery. Library changes stay in memory unless source saving is enabled.
- Adds movie and series details with descriptions, artwork, credits, season selection, and paged episodes. Audio/subtitle controls use tracks exposed by Shaka, Samsung AVPlay, or HTML video; unsupported controls explain the limitation.
- Keeps provider settings in memory by default. Opt-in persistence uses unencrypted TV browser storage, with a Forget action. Turning Remember off removes the selected saved source and its library, preserving other profiles.
- Includes original Lanternfin branding, original-project attribution, GPL license, source revision, and asset hashes in the packages.

This remains **development software, not complete Android feature parity or certified TV support**. Xtream search spans the loaded library across live, movie, and series categories; incomplete indexing is explicitly labeled. New Xtream favorites/recent bookmarks restore immediately after reconnecting a saved account. Live now/next guides support Xtream and M3U XMLTV feeds. Samsung single-file downloads and manual update checks are implemented; signed distribution and physical-TV validation remain outstanding. Programme replay is implemented for supported provider archive formats. See [the parity ledger](TV_PARITY.md) for the remaining work; device testing does not replace unfinished software features.

### DRM and custom headers

The port preserves M3U `#KODIPROP` license settings, `#EXTVLCOPT` User-Agent/Referer settings, and URL-pipe headers. Protected/header-dependent entries are no longer discarded. Artwork and media kind are retained, with HTTP/HTTPS-only artwork and inert text rendering.

| Requirement | Current implementation and limit |
| --- | --- |
| HLS / DASH | Shaka, using MSE when available; native Samsung path for compatible unprotected streams. Unprotected HLS can fall back to native HTML playback when available, after releasing Shaka. DRM/header requirements are never dropped to trigger fallback |
| Widevine / PlayReady | Shaka EME configuration with provider license URL; requires a compatible CDM, codec and valid provider access; not yet verified on physical TVs |
| ClearKey | Up to 64 explicit, distinct 32-character hexadecimal KID/key pairs passed to Shaka; not a DRM bypass |
| License authorization headers | Sent only on license requests, separate from media credentials |
| Media authorization headers | Sent on Shaka manifest, segment and encryption-key requests; provider must permit cross-origin requests. Direct MP4 header injection is unsupported on this path |
| User-Agent / Cookie | Samsung AVPlay native streaming properties; real-TV verification pending |
| Referer, Origin and other browser-controlled headers | Explicit unsupported message; never silently ignored. A provider-compatible URL or separately designed, opt-in local relay is needed |
| Kodi license payload/response transforms | Raw/default `R`, bounded `b{SSM}` base64, `B{SSM}` URL-encoded base64 and `D{SSM}` decimal request templates; raw, base64 `B`, top-level JSON `Jfield`/`JBfield` responses. Session/key/PSSH/URL placeholders, nested fields and HDCP policy extraction need a provider-specific integration and are explicitly rejected |
| LG simulator | UI and unprotected playback only; LG documents no DRM or mediaOption support |

[Shaka’s platform matrix](https://github.com/shaka-project/shaka-player#platform-and-browser-support-matrix) includes Samsung; webOS is community supported. [Shaka’s DRM configuration](https://shaka-project.github.io/shaka-player/docs/api/tutorial-drm-config.html) and [license header guide](https://shaka-project.github.io/shaka-player/docs/api/tutorial-license-server-auth.html) describe the integration. [LG’s DRM matrix](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm) supports PlayReady and Widevine on real TVs, while the [simulator limitations](https://webostv.developer.lge.com/develop/tools/simulator-introduction) explicitly exclude DRM. Samsung’s [AVPlay reference](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html) documents the native streaming properties.

React and Next.js are presentation frameworks, not a solution to CDM, codec, CORS or forbidden-header limits. We retained the original project’s lightweight TypeScript interface approach and added Shaka as a playback adapter. A future component-framework migration should be justified by maintainability, not DRM support.

## Compatibility approach

Hardware target: **LG webOS 6 / 2021 and newer consumer TVs**, including the C1, and **Samsung Tizen 6.5 / 2022 and newer**. These remain engineering targets pending model/firmware tests. Earlier TVs, hospitality sets, signage, and store distribution are outside this build's claim.

The portable UI uses a classic bundled script, relative packaged resources, plain CSS, and a Chrome 79 compilation target for the app and workers. It imports the upstream pure M3U parser without importing Tauri, Android receiver code, Tailwind 4, or the desktop player stack. Engine versions are documented by [LG](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) and [Samsung](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

An LG C1 installation exposed an actual startup gap: the previous Chrome 85 bundle retained syntax unavailable in Chromium 79, and `Element.replaceChildren()` stopped initialization on older engines. The build now lowers that syntax, supplies the missing DOM operation before app initialization, and detects missing flex-gap support for spacing fallbacks. Every build, including the setup wizard, parses all emitted JavaScript (including media engines and workers) against an ES2019 syntax ceiling and exercises the packaged app's setup controls and diagnostics with `replaceChildren` removed. This is a focused compatibility regression check, not a substitute for a real Chromium 79 or TV test.

Packaged CSP rules explicitly allow local `file:` styles, fonts, artwork and workers as well as scripts; opaque file origins cannot reliably be assumed to match `'self'`. Inline/evaluated/remote scripts remain disallowed. An independent ES5 startup guard reports missing styles or incomplete initialization with just the browser version, without exposing provider addresses or raw exceptions. If the TV shows a blank/unformatted screen, choose **Build this checkout → Install Lanternfin** in TV Setup, then fully close and reopen the TV app. No source deletion or TV reset is required. Samsung signing now stages the complete build, including its engines, workers, translations and licenses.

Validation of this correction: **217 test files / 3,341 tests**, TV type checks, all three builds, the packaged syntax/DOM checks, and browser setup/diagnostics navigation passed. The old packaged app demonstrably failed ES2019 parsing and threw when `replaceChildren` was absent; the corrected packages pass both checks. The reported C1 remains pending an on-device retest; this does not establish DRM, codec or video-plane behavior on that TV.

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

The TV runtime bundle contains this UI, playback adapters, Shaka, fflate, and the existing M3U parser and XMLTV worker. LG's official packaging CLI is isolated under `packaging/tv-tools`, installed with lifecycle scripts disabled, and never shipped to TVs. Its 3.2.6 distribution bundles old dependencies: the local audit found **8 affected dependency records (7 high, 1 moderate)**, including `braces`, `brace-expansion`, `js-yaml`, and `qs`. Normal npm overrides did not replace the bundled copies, so no ineffective override is claimed as a fix. The tool is currently used only on our fixed local app resources. This remains a build-tool risk to revisit before release. The earlier repository-wide findings in [the fork review](fork-review/README.md) also remain applicable to the broader project.

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
2. **Expand the shared catalog:** build on the implemented Xtream categories, details, favorites and resume state with cross-category search and bounded persistent indexing.
3. **Add a TV guide and validate playback controls:** EPG cache with memory limits, physical-TV audio/subtitle checks, then catch-up and format-specific fallbacks based on device evidence. Add one capability at a time to the hardware matrix.
4. **Prepare distribution:** settle the supported model years, resolve dependency findings, complete trademark/name checks and notices, privacy/store materials, accessibility tests, repeatable source publication and signing backups. Store submission is a separate milestone.

## Work toward everyday use

The 8 MiB / 30,000-entry prototype restriction has been removed. The first hardening checkpoint passed all 153 test files / 3,080 tests, including split UTF-8, cancellation of stalled reads, downloads lasting longer than the old deadline, line/response memory guards, and shared-parser regressions. A real browser loaded all 120,000 entries from a streamed synthetic playlist and located entry 120,000 by search. The synthetic fixture uses unavailable media URLs and validates catalog behavior, not playback. Run `node scripts/preview-tv.mjs --fixtures --port 4324` and load `http://127.0.0.1:4324/_test/large.m3u` to repeat it; this public test-data endpoint allows simulator origins.

The broader readiness goal remains active: favorites, recent streams, resumable VOD, playback recovery, and category-based Xtream browsing are implemented. Program information, cross-category search, further UI parity, and a measured device acceptance pass remain. Passing the catalog checkpoint alone does not meet that goal.

The library checkpoint passed the full suite (154 files / 3,091 tests), followed by an additional application integration test covering favorites, resume prompts, failed-source recovery, refresh, and forgetting. Browser testing played MDN's public five-second MP4 and verified favorites and recent history survived a reload after explicit saving. VOD resume and decoder lifecycle are tested with controlled HTML/AVPlay doubles; real-TV seek behavior remains an acceptance item. Saved library records contain lookup identifiers and playback positions, not stream URLs; the separately opted-in source settings still contain provider credentials without encryption.


## UI and adaptive playback checkpoint

The rebuild restores sidebar navigation, an artwork hero, bounded home rails, poster grids, separate Live/Movie/Series browsing, and the original TV UI’s dark/pink visual treatment. The original Astro/Tailwind/desktop dependencies are not pulled into the packaged TV entry point. The small portable presentation module records its original UI sources for attribution.

Validation: the full suite passed 158 files / 3,106 tests at the first rebuild checkpoint. Browser testing successfully played Shaka’s public Angel One DASH sample. Mock-provider browsing verified movie categories, series artwork, and season/episode results. DRM configuration, media/license header isolation, invalid metadata, pending-load cancellation, and provider response limits have controlled tests; those tests do not establish TV DRM compatibility.

Build output for LG’s simulator remains `dist/tv/webos`. Reload that folder using the simulator’s app launcher; do not open the Android/Astro build. The packaged Shaka script and its Apache license, plus the bundled Geist font license, are included alongside the app.

For UI-only provider tests, run the preview server with `--fixtures --port 4324` and enter an Xtream account at `http://127.0.0.1:4324/_test/provider` with username/password `demo`. The generated artwork is labelled UI TEST LIBRARY and media URLs deliberately fail. These fixtures are not included in TV packages.

Remaining acceptance work: physical LG and Samsung DRM/license/codec/header matrix; broader provider catalog/EPG tests; comparison against the original UI at each screen; extended remote navigation and playback soak tests. The broader readiness goal remains open.

## Details, bookmarks, and track controls checkpoint

Movie/series detail pages now show provider descriptions, poster/backdrop artwork, year, genre, duration, rating, director, and cast where supplied. Series expose season selection and paged episodes. Back from playback returns to the same details and season. Empty or failed metadata responses retain a usable page and retry path.

Opted-in Xtream bookmarks persist bounded item IDs, names, groups, and file extensions, rebuilding playback addresses from the separately saved account. Library records do not duplicate provider URLs, account passwords, media headers, or license keys. M3U library records still contain identifiers and positions only. Forget removes source and library records; without Remember, all changes remain session-only. This remains unencrypted local storage.

The playback menu lists audio and subtitle tracks from the active engine, supports subtitle Off, and traps remote/keyboard focus in the menu. Shaka uses its 5.2.8 audio/text selection APIs. Samsung audio changes require playing state; native DASH text selection is unavailable and is not offered. HTML controls appear only when the browser exposes the corresponding tracks. Manual track choices apply to the current stream. Saved preferred audio and subtitle languages are now applied when the next stream starts.

Validation: **158 test files / 3,115 tests** and TV type checks passed locally. Browser checks verified movie details, favorites restored after a reload before category loading, season switching, and return to the selected season after a failed test episode. Shaka's public Angel One DASH stream played successfully, switched to French audio and English subtitles, retained those selections when reopening the menu, and turned subtitles off. Native Samsung track behavior has controlled tests and still requires hardware validation. No protected provider content or physical-TV DRM was tested.


## Guide, library and settings checkpoint

The Live TV screen now follows Android’s compact navigation rail, category column, channel list and programme panel. The guide decodes Xtream programme data and reuses the original streamed XMLTV worker for M3U feeds. XMLTV has a 64 MiB decoded-data budget, a 25,000-channel budget, cancellation and idle timeouts; only requested channel schedules return to the UI. Raw gzip feeds use the browser decompression API when available, with a locally bundled, bounded fflate fallback for older engines. Refresh guide downloads a new XMLTV feed; feeds also expire after six hours. Guide data is session-only.

Xtream indexing visits categories sequentially, retains at most 500,000 titles / 64 Mi characters, retries failed categories and exposes pause/resume. Search reports whether the library is complete. A failed category does not discard successful categories. This index is session-only by default. An explicit per-source option can now save a bounded catalog for faster startup.

Settings now include dark/light/device themes, twelve accents, interface size, screen margins, reduced animation, preferred audio/subtitles, and guide clock time zone. Appearance preferences are separate from credential storage. The browser check covered whole-library search, both guide paths, light theme at 130% size with 5% margins, and restored defaults. The complete suite passed **162 files / 3,129 tests** before final layout/focus refinements; a fresh checkpoint run follows those refinements. Real-TV decoder, DRM and remote behavior remain unverified.


## Source management and remote playback checkpoint

Up to 20 explicitly saved, named sources can be opened, edited or removed independently. Existing single-source installations migrate on their next save. Editing an address replaces the selected profile rather than retaining its old credentials; removing a source removes its library, and Forget all removes every source/library. Saved source credentials remain unencrypted.

Live playback now supports Channel +/−, numeric tuning, and now/next programme information. The queue preserves the selected live list and excludes VOD. A short OK press opens a card; holding OK, Info, or a context-menu action opens favorite/history actions. After changing a card, focus returns to its visible replacement. Continue-watching rails show progress. Series remember the selected season and support next episode; opt-in automatic continuation gives a cancellable ten-second countdown. Unsuccessful playback attempts no longer add history.

Validation: TV type checks and **165 files / 3,137 tests** passed. Browser checks verified numeric tuning, profile persistence and independent removal, retained favorites, and actual public Shaka DASH playback with French audio / English subtitles selected automatically. Tests cover held-OK repeats, number cancellation, series continuation/cancellation, and restoration of the last season. Vendor key registration follows [Samsung’s remote reference](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html); physical remote validation remains pending.


## Guide replay and library filtering checkpoint

Guide dates now expose past/current programmes and upcoming schedules. Programme pages show the full description, live playback, and replay when advertised within the provider retention window. Xtream archives support HLS, TS and legacy formats with provider-clock detection or an explicit manual offset. M3U archive templates reuse the original project's expansion rules. Replay never drops DRM/header settings; custom media headers cannot be redirected to a different archive host. Unsupported templates and missing server clocks produce an actionable message.

Browse/search now includes natural title sorting, content-kind filtering, manual watched/unwatched marking and Hide watched. Completed playback marks VOD watched; watched history retains the existing 100-entry bound. Sorting yields to navigation and can be cancelled on large catalogs. Raw compressed XMLTV works on engines without DecompressionStream through pinned fflate 0.8.3 (MIT license included), with compressed/decompressed byte limits and cancellation.

Validation: **168 files / 3,148 tests** passed, with TV type checks. Browser checks verified past programme details, construction of a replay request, return to the same programme, natural descending title order and watched filtering (10 titles became 9). The synthetic replay endpoint deliberately has no playable media, so this verifies the interface and request path, not real-provider archive playback. Real archive access, codec, DRM and TV behavior remain acceptance items.


## Continuation, picture controls and source details checkpoint

Saved episode bookmarks now retain a bounded parent series ID/title. Reopening an episode from Recent can load its next episode list without revisiting the series page; cancelled or stale responses cannot replace a newer queue. Series playback selects the first unwatched episode when there is no saved resume position. Watched IDs now have their own 10,000-item bound and survive eviction from the 100-item Recent list. A watched badge and explicit Mark as unwatched action expose that state.

The player has a remote/pointer seek bar and a Playback settings menu with audio, subtitles, video quality and picture size. Shaka quality changes use its video-only selection API, preserving audio; Automatic re-enables adaptation. HTML/Shaka offer Fit, Zoom and Stretch. Samsung native playback offers the documented Fit and Stretch modes; it does not pretend to expose unsupported zoom or manual adaptive quality. These changes use [Shaka's player API](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html) and [Samsung's display-method API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html).

Guide options on the source form accept an optional XMLTV override without changing its library identity. It is persisted only with the source. Settings also exposes provider-reported Xtream account status, expiry and connection limits without displaying credentials or raw provider messages.

Validation: TV type checks and **170 files / 3,156 tests** passed. Tests cover cold episode restoration, cancellation/source-switch races, independent watched retention, native display state restrictions, quality/audio separation, seek controls and account sanitization. Browser playback of Shaka's public DASH sample verified available resolutions, 360p selection, zoom, preserved French audio and remote seeking. No physical-TV quality/display behavior is claimed verified.


## Saved catalog checkpoint

Remembered Xtream sources can separately opt into **Keep the catalog for faster startup**. The IndexedDB cache uses 500-record chunks, a 500,000-record / 64 Mi-character serialized budget, bounded metadata, and a six-hour expiry. Only complete indexes are published. Stream addresses are rebuilt from account settings; cached records include bounded titles, groups, provider IDs, archive metadata and artwork addresses. Artwork addresses may contain provider tokens, so this is opt-in, unencrypted storage alongside the separately saved account. No downloaded video, license keys or copied stream URLs are cached.

Opening a fresh cache labels the library as saved and immediately makes all its categories searchable. Refresh bypasses the cache. Storage failures or rejected caches fall back to ordinary provider loading. Clear saved catalogs preserves source settings and viewing progress. Removing a source, turning Remember off, or Forget all removes the corresponding cache and cancels writes that could recreate it.

Validation: **171 files / 3,160 tests**, TV type checks, and a real browser cold reload of the 30-title test-provider cache. The UI reported Saved library after restart and confirmed clearing saved catalogs. Database tests cover chunk restoration, per-account isolation, six-hour expiry, invalid/incomplete metadata, cancellation, and forgetting during a pending write. fake-indexeddb 6.2.5 is a test-only dependency and is not bundled on TVs. IndexedDB quotas/availability on physical TVs remain to be measured; failure does not prevent session use.


### Transport playback and license formats (2026-10-03)

The portable player now bundles mpegts.js 1.8.0 locally for unencrypted MPEG-TS, M2TS and FLV streams when MSE is available. It preserves permitted media headers, disables library URL logging, limits retained video buffers, and cancels pending startup on navigation. Samsung still prefers its compatible native player. Transmuxing cannot supply an unsupported decoder or decrypt protected transport files. See the [mpegts.js API](https://github.com/xqq/mpegts.js/blob/master/docs/api.md).

Kodi's ordinary `|R` license response is accepted. The documented base64/decimal request and single-field JSON response subset is implemented with bounded input and no script evaluation. Unsupported session/key placeholders or HDCP extraction are rejected rather than silently ignored. Media credentials also reach Shaka's encryption-key requests; license credentials remain separate. See [Kodi's legacy DRM format](https://github.com/xbmc/inputstream.adaptive/wiki/Integration-DRM-(old)) and [Shaka license wrapping](https://shaka-project.github.io/shaka-player/docs/api/tutorial-license-wrapping.html).

Playback settings now exposes 0.5–2× speed for finite HTML/MSE video and 1×/2× for compatible Samsung native VOD. Live channels keep normal speed; each new stream resets speed. Samsung rates and audio behavior depend on the protocol/device and failures are reported.

Validation: TV type checks and the full suite passed **173 files / 3,172 tests**. The browser decoded and paused a public 10-second MPEG-TS segment from Mux's Big Buck Bunny sample and accepted 1.5× speed. Controlled tests cover delayed startup, stale errors, teardown failures, timeouts, forbidden-header/DRM rejection, native speeds and license wrappers. This does not validate real provider DRM, continuous live TS streams, or native TV playback.


### Large-library remote browsing (2026-10-03)

Poster grids now continue across pages with Up/Down while keeping the selected column. Page Up/Down (or channel keys while focused on the catalog) jump pages; a bounded page-number field supports distant jumps. Filters include Only watched, Hide watched, provider title-language tags, and Reset filters. Language tags reuse the original Android helper and do not assert which audio tracks a stream contains. Only watched resolves marks against loaded catalog/bookmarked titles; episodes absent from that pool appear after their series/history is loaded.

Validation: **174 files / 3,173 tests** passed. Browser checks covered remote page continuation in a 60-title fixture, French filtering to 30 titles and the final six-title page. Controlled UI tests also mark/unmark watched titles through card actions while filtered. The fixture contains generated artwork and no playable media.


### Encrypted backup and restore (2026-10-03)

Backup and restore is available both from initial setup and Settings. It includes only remembered sources, their favorites/recent positions/watched marks/season choices and normalized preferences. Catalog caches, downloaded video and temporary session sources are excluded. Export uses a separate 12–256-character passphrase, Web Crypto AES-256-GCM with a random 96-bit nonce and 128-bit authentication tag, and PBKDF2-SHA-256 with a random 128-bit salt and 600,000 iterations. The versioned format fixes the derivation cost and authenticates a format-specific label. No backup is uploaded, and there is no unencrypted-export fallback. See the [Web Crypto derivation API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) and [OWASP work-factor guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Import rejects invalid formats, duplicate/unsafe sources and invalid library records before writes, with an 8 MiB decoded / 12 MiB file/text ceiling and the existing per-library limits. Review precedes restore. Existing source names/settings take priority; favorites and watched marks merge; the newest 100 recent entries survive; preferences are optional. Only application-owned keys are written. A failed write attempts rollback of completed writes and explicitly reports rollback failure if storage becomes unavailable. Local storage is not transactional across a process crash. Restored account data remains in the TV's unencrypted app storage, as stated in the screen. Passphrase inputs and temporary backup results are cleared on exit; JavaScript does not guarantee erasure of every memory copy.

Files can be saved/chosen where the platform supports it, with encrypted-text copying/pasting as an alternative. Web Crypto requires a supported secure context. Physical-TV file, clipboard and keyboard behavior remains an acceptance item; no LAN service is opened automatically.

Validation: **176 files / 3,180 tests** and TV type checks passed. The browser exported, reviewed and restored two generated test sources without duplication. Its downloaded `.lftv` file authenticated and decrypted independently. Tests cover ciphertext tampering, wrong passphrases, limits, field validation, merge priorities, quota rollback and discarding a late encryption result after leaving the screen. The full run caught and fixed a fresh-install focus regression: the source form still receives initial focus.

### Lifecycle and local diagnostics (2026-10-03)

Samsung screen-saver requests follow foreground playback, and late callbacks cannot leave the saver disabled after leaving the app. LG packages declare Type 2 for playback with on-screen controls. Background transitions save playback progress, stop video, cancel foreground requests, clear transient backup contents and pause library indexing. Return resumes only previously running indexing. Actual TV standby and OLED dimming still need device verification; see the policy and vendor references in `TV_PARITY.md`.

Device & playback diagnostics is available from setup and Settings. It exposes the source build commit/modified flag, local media API signals, six example codec profiles, native Samsung API presence, bounded numeric player statistics and the last 80 playback-state transitions. The visible event list shows the last 12. The report is assembled from an allowlist: no titles, source/stream/license addresses, account data, header names/values, DRM keys, provider response bodies, device identifiers or raw exception strings are included. Nothing is uploaded or persisted automatically. View, copy or save the report; clear discards session diagnostics. File/clipboard controls remain subject to TV support.

Capability checks call only local `canPlayType` / `MediaSource.isTypeSupported`. DRM API presence is not a DRM-system or license test; no `requestMediaKeySystemAccess` probe or license acquisition is triggered by the screen. Native AVPlay support can differ from browser codec reports. Shaka's numeric statistics use the bundled engine's `getStats` API.

Validation: **179 files / 3,188 tests** and TV type checks passed. The browser rendered actual codec/API reports. Tests cover late screen-saver callbacks, duplicated lifecycle events, native playback progress preservation, manual index pauses, transient-secret clearing, diagnostic allowlisting, bounded logs, broken device APIs and copy fallback. Physical TVs are still required for native lifecycle and protected playback acceptance.

### Bulk viewing-data management (2026-10-03)

Manage viewing data shows current-source totals for favorites, recent/resume records, watched marks and saved season choices. Select areas, review totals and explicitly apply. Recent's Clear history button now opens this reviewed path. Other sources, provider catalogs and account settings are unaffected. A backup shortcut is available before changes; session-only sources are still excluded from encrypted backups.

Clearing writes the complete library once and rolls back the in-memory change if storage rejects it. Undo is offered while the screen remains open, refuses to overwrite newer library activity or another window's saved changes, and can retry a failed storage write. Clearing watched marks also clears legacy completed flags in recent records so marks do not reappear after reload. Clearing history alone preserves watched marks. Undo is temporary; encrypted backup is the recovery path after leaving the screen.

Validation includes actual browser review, clear and Undo of the generated test source's favorite. Tests cover persistence/reload, selected-area isolation, reference restoration, failed writes, newer activity, another window, confirmation cancellation and the backup return path. No real user library was cleared.

### Content language and version grouping (2026-10-03)

Settings can opt into grouping movie/series language versions and select a preferred content language (Automatic follows the device). Home, its featured title and catalog/search cards select that language when available, prefer a plain prefix over quality-tagged alternatives, and expose version counts. Details includes a version picker. Favorites, recent items and all viewing progress remain tied to the exact original stream; grouping never merges their IDs or silently switches a saved bookmark.

Grouping reuses the original provider-language/prefix helpers but matches conservatively within a content kind: normalized case/whitespace, identical remaining title, preserved punctuation, accents, years and editions, and at least two distinct language tags. Untagged entries, live channels and episodes remain separate. Translated titles and missing/inconsistent year metadata cannot be matched reliably without further provider identifiers; no metadata service is contacted. Buckets over 100 entries remain ungrouped to keep the version picker bounded. Grouping yields and cancels with navigation/search; switching it off restores separate cards. A specific language filter is applied before grouping.

The browser reduced six generated variants to three cards, selected French for the featured movie, and switched to the English version in details. Controlled tests cover home/catalog consistency, independent favorites, filters, year/edition/content-kind separation, oversized buckets and cancellation. These fixture files contain artwork but no playable media.

### Interface language foundation (2026-10-03)

The 16 original community interface languages are selectable in Settings, including a device-language default. Fifteen non-English dictionaries are built from `src/i18n/` into locally packaged scripts; English is the fallback. No online translation service or desktop i18n storage is used. Language preference is included in encrypted backups. Arabic and Urdu use RTL layout with the navigation rail on the right, while source/password and diagnostic/backup text fields retain LTR input.

Static text is captured once before provider data loads. Dynamic provider titles/categories are never passed through translation. Navigation, common settings, home-row headings and core controls use the existing translated messages. New fork-specific labels, instructions and several dynamic status messages still use English; this is a partial interface translation, not a claim that every portable-app string is localized. Completing those translations remains tracked in `TV_PARITY.md`.

Locale loads are limited to packaged filenames, time out after five seconds, are retryable on failure and discard stale completions when the selection changes. Tests cover plain-text interpolation, preservation of icons/provider content, fallback/region matching, RTL direction and cancellation races. Browser checks verified French labels and Arabic RTL settings. Font shaping and remote navigation on physical TVs still need acceptance testing.


### Samsung offline downloads (2026-10-03)

Downloads is available from setup, the navigation rail and Settings. Movie details and an episode’s Hold OK menu offer a review before starting. The native adapter uses Samsung’s documented [Download API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/download-api.html) with request headers, and the modern [Filesystem API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/filesystem-api.html) for generated names under `wgt-private/lanternfin-downloads`. The widget requests the public download, filesystem.read and filesystem.write privileges. Capability checks and errors remain visible; there is no fallback to shared storage.

Only explicitly classified movies/episodes with MP4, M4V, WebM or MKV URLs and no DRM, manifest override or invalid playback configuration qualify. This does not prove that the returned file has a TV-compatible codec. No HLS/DASH package or persistent DRM license is copied. Download metadata contains a bounded title, generated key/filename, transfer ID while active, byte counts, state and offline resume position. Source addresses and headers go to the OS transfer service but are not copied to app metadata, diagnostics or backups. Video is unencrypted in app-private storage. The review explains this before a transfer starts.

One transfer may run at a time, with at most 20 entries, a 2 GiB file limit and a 4 GiB library budget. Incomplete or failed transfers reserve a full file allowance until removed. Limits are enforced on native progress callbacks and completed file sizes, not as an atomic filesystem quota; the OS can write additional bytes between callbacks. Actual available TV space may be lower. Backgrounding requests pause, with cancellation if pause fails; returning does not auto-resume. Reopening checks ownership of saved native IDs before attaching listeners, pausing or canceling. Uncertain service failures preserve the transfer instead of permitting file removal.

Cancellation precedes removal of an active transfer. Removal has a separate review and deletes only its generated file, never directories or native callback paths. Completed files are checked again before playback. A WeakMap capability connects only verified saved-media objects to local AVPlay access; copied provider objects and plain file URLs still fail HTTP validation. Offline viewing works without an open source, survives a network-offline event, and saves its own resume position without polluting provider favorites/history. An abrupt process crash between native transfer creation and saving its ID cannot be made transactional; such an entry is never assumed playable merely because a partial file exists.

Tests cover credential exclusion, unsafe media, storage errors, late callbacks, native ID reuse/ownership, unknown transfer state, size budgets, background recovery, path restrictions, reviewed removal, offline playback/resume and network loss. Browser checks cover layout and the explicit unavailable state. **A physical Samsung TV is still required to verify that its transfer service accepts app-private destinations, permissions, codecs, pause/resume and restart behavior.** LG/browser builds show the limitation and do not simulate successful video downloads.


### Manual update workflow (2026-10-03)

App updates in Settings and About shows the installed version, source commit and modified-build status. Opening the page performs no network request. Check updates explicitly reads this fork’s public TV branch reference and latest 20 releases, without credentials, referrer, source data or viewing history. Both responses have a 1 MiB ceiling and 15-second timeout; leaving/backgrounding cancels the check, stale results are discarded and checks are throttled to once a minute. Partial failures remain unknown rather than claiming the app is current.

Release candidates require the fork’s exact release-page URL, an uploaded LG IPK or non-UNSIGNED Samsung widget filename, and bounded metadata. Android-only releases are excluded. Prereleases are identified. A filename is only a candidate filter: it is not a signature, package integrity, compatible model or newer-version guarantee. No asset is downloaded or executed; links open the release notes. The source check compares exact commits and reports a different revision without asserting that a locally modified/ahead build is outdated.

Developer updates follow the visible backup → GitHub Desktop fetch/review/pull → build current checkout → Samsung sign if needed → reinstall → verify revision sequence. The setup companion now labels the LG action **Build this checkout** to avoid implying it fetches source. Keep a working installer and encrypted backup, preserve app/signing identities, and validate data retention on the target TV. Developer-session expiry, reinstall or clearing app data may remove local video. Store distribution and a signed release/update channel remain separate acceptance work.

The setup installation page shows the package version, source revision, local-change status and checked asset count. After a successful installation it also records that TV's last installed revision for the current setup session; rebuilding does not relabel the old installation as the new one. **Refresh package status** rereads the LG installer, and damaged/incomplete packages disable installation while keeping rebuild available. Closing/reopening the wizard clears session installation history, not the TV's app or saved sources.

Both packaging commands now inspect the finished archive and compare its embedded build record with the source build. The wizard repeats verification before installation, and checks Samsung's signed output against the exact staged build record. Every declared file must match its SHA-256; main scripts, styles, startup guard, workers, both player engines, icons, licenses and all shipped translations are mandatory. Duplicate/unsafe paths, conflicting ZIP headers, CRC errors, malformed tar checksums, links, oversized expansion and unrecorded app files are rejected without extraction. Bounds are 100 MiB for the archive/expanded contents, 32 MiB per member and 512 archive entries. These checks establish package completeness/integrity, not trusted authorship or freedom from malicious source code. Samsung signature files are required, but the TV remains responsible for cryptographic certificate validation. The [Tizen CLI build](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html) is run without resource optimization so the already-built app assets remain unchanged.

Regression checks use complete generated ZIP and ar/tar fixtures, then remove or alter assets and assert that installation commands never run. The real LG IPK and unsigned WGT also pass the inspector. The suite includes the wizard's ready/last-installed revision display and damaged-package recovery state. This does not replace installing and playing on a TV.

API contracts: [GitHub public releases](https://docs.github.com/en/rest/releases/releases#list-releases) and [Git references](https://docs.github.com/en/rest/git/refs#get-a-reference). Tests exercise target filtering, foreign links/drafts/unsigned assets, secret exclusion, bounded/stalled responses, partial failures, cancellation, modified builds, HTML-safe rendering and cooldown. No TV release has been published as part of this check.


### Large saved-library responsiveness (2026-10-03)

Rebuilding the in-memory Xtream index from an opt-in saved catalog now stages data in cooperative slices and accepts cancellation. A source is not applied or remembered until that restoration finishes. A canceled or over-budget snapshot does not publish partial categories/titles; live loading remains the fallback. The combined search/home library memoizes unchanged inputs and uses the provider index’s existing membership map instead of rebuilding a full 500,000-title identifier set on every visit. Matching catalog arrays are reused when there are no extra bookmarks; source forgetting releases the memoized array.

A deterministic 50,000-title test verifies yielding and delayed publication; cancellation and budget tests verify an unchanged index and a subsequent successful retry. Existing source, cache, favorites, search and lifecycle integration tests still pass. This removes repeated work but is not a measured latency guarantee for TV hardware. Large network category parsing/storage, title grouping and device memory still warrant real-TV profiling.


### Archive provider clocks and guide rollover (2026-10-03)

Xtream replay now accepts a valid IANA timezone when the provider omits its wall-clock/epoch pair. It uses numeric `Intl.DateTimeFormat.formatToParts` fields, including UTC and fractional zones, without relying on the newer longOffset presentation. Valid explicit clock pairs remain authoritative if they disagree with a named zone. When they agree, the offset is evaluated at the programme’s time so replay across a daylight-saving transition uses the historical offset. Invalid zones do not silently fall back to UTC; malformed calendar dates and implausible offsets require the existing manual clock choice. Provider archive conventions can still differ and need a real stream check.

The foreground live guide refreshes its day choices after midnight without changing a still-available selected date. A date that falls outside the seven-day/two-day window returns to Now & next and reloads the selected channel. An open native picker is left alone until it closes. Tests cover timezone-only accounts, UTC/fractional offsets, DST boundaries, inconsistent clocks, invalid dates and the real app’s midnight selection behavior.


### Stable browsing and remote playback overlays (2026-10-03)

Home refresh prepares replacement rails before changing the visible page. The focused title and its specific row, plus horizontal row positions, survive refresh; moving to the sidebar during preparation does not pull focus back. Canceled or superseded refreshes preserve existing cards. Empty search, favorites and recent views explain the state and offer reset, home or continued indexing as appropriate; empty results hide pagination.

Playback separates primary transport controls from secondary actions, includes the channel artwork when available and shows remaining time. With controls hidden, Left/Right seek eligible VOD by ten seconds and show a compact three-second readout of the actual player timeline. OK reveals controls without activating the previously focused hidden button. Native media keys share the same eligibility check; live, invalid, loading and unavailable timelines cannot seek. Buffering shows a small badge without forcing the full controls over a remote seek. Pause/errors/end still reveal the relevant controls. Artwork and provider titles remain plain data.

Validation: TV type checks and **191 files / 3,239 tests** pass. Browser verification played the repository's public Shaka Angel One HLS sample and exercised actual seeking/buffering, plus the local fixture's empty-search recovery. Native seeking and remote behavior still require physical-TV acceptance. This is another parity increment, not a declaration that all software work is finished.


### Watchlist parity (2026-10-03)

Save for later is available on movie/series details and Hold OK menus. Watchlist has its own navigation destination and Home rail, with newest saved first unless an explicit catalog sort is selected. It preserves the exact language version and stays independent of favorites, history and watched marks; starting or finishing playback does not remove a saved choice. Live channels and individual episodes are excluded, matching the original movie/series list.

Each source can hold 2,000 watchlist IDs. Xtream stores bounded account-derived title references so entries can return before the full provider index; M3U entries reappear when the matching playlist loads. No extra stream addresses, headers, keys or provider credentials enter library bookmarks. Session-only sources remain session-only. A failed watchlist storage write restores the previous in-memory list; conflicting other-window changes require reopening the source.

Reviewed bulk cleanup includes Watchlist, with the existing guarded Undo. Encrypted backup review displays its count and merges it only when library import is selected. Older backups without this field remain readable. Combined favorites, watchlist and history references are capped at 4,100, with the existing 2 MiB per-source serialized library ceiling and 8 MiB decoded backup ceiling. Older app builds do not understand this new field; keep a current-build backup before downgrading.

The regression suite passed **192 files / 3,243 tests** before the final newest-first change; targeted tests then passed including the added duplicate/order regression. Browser checks added a fixture movie from details and displayed it in Watchlist. Coverage includes independent source state, reload, reference privacy, unsupported content, entry limits, failed writes, selected-area cleanup/Undo, legacy backups, invalid imports, merge and the real app's remote-menu empty state.


### Home row customization (2026-10-03)

Settings → Home screen edits the available row types: continue watching, watchlist, recent, favorites, live, recently added movies/series, movies and series. Checkboxes control visibility; Move up/down controls order and preserve remote focus. Edits remain a draft until Save; Back/Cancel discards them. Default rows restores the draft for review. An empty selection is allowed: the featured title and browsing shortcuts remain available. Up to eight custom category rows can be added from the active source; cross-source recommendations are not implemented.

Home layouts now save with the current source's library. The original app-level row preference remains the fallback until that source is customized. Saving one source does not change another. Remember this source is required for persistence; otherwise the editor reports session-only use. A failed write restores the previous layout and stale app windows cannot overwrite a newer layout through the editor. Edits and category search cancel when leaving the editor.

The category picker supports live, movie and series categories. It searches loaded Xtream IDs or M3U group names with a cancellable scan, exposes at most 100 matches and offers Refresh choices as the provider index grows. Duplicate provider names retain distinct IDs. Custom labels are rendered as text. Add, remove, hide and reorder controls operate on a local draft; hidden category definitions remain available until explicitly removed. Use default rows selects standard rows and hides custom ones in the draft. Category selection stores bounded IDs/names, with no copied source login or playback configuration.

Each visible category row shows up to twelve distinct titles and a View all action. Language grouping stays within that category. Empty/unloaded category rows retain the action; opening a category can recover a failed provider-index category and display its current results back on Home. A removed M3U group produces an empty filtered grid, never a fallback to the whole library. Rendering preserves row-specific card/action focus and scroll. TV decoding and physical remote acceptance are still pending.

Source layouts travel with optional library import in encrypted backups. Existing local layouts take priority, legacy backups remain readable and malformed category definitions are rejected before restore writes. Original global row preferences still follow the separate preference-import option. Normal library cleanup and Undo preserve Home configuration; forgetting the source removes its layout. Downgrades to older builds cannot preserve these new source-specific fields.

Validation: TV type checks and **196 test files / 3,268 tests** pass, with additional focused verification of failed-category recovery and removed playlist groups. Unit/UI integration coverage includes category bounds, duplicates, source isolation, storage failure/conflicts, canceled searches, backup migration/merge, category-local versions, remote focus and exact provider-ID navigation. Browser checks created and reordered a fixture “Movie night” row, opened its complete grid and verified the saved row after reload. Screenshots are local test artifacts; no provider credentials or real media were used.


### Subtitle presentation controls (2026-10-03)

Shaka playback now supplies its packaged UI text renderer with the existing video surface. This exposes text size (75–200%) and timing (five seconds earlier/later, in half-second choices) through Playback settings. Changes update already displayed cues, work while paused and reset for a new stream. Bitmap captions need not respond to text size. The interface only advertises these controls when the renderer and subtitle tracks exist; plain HTML, transport and Samsung native playback show them unavailable.

The bundled Shaka 5.2.8 source documents `textDisplayer.fontScaleFactor` and `subtitleDelay`; its native text displayer applies delay only when appending new cues, so the UI renderer is used for immediate adjustments. Samsung's [setSubtitlePosition documentation](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html#setSubtitlePosition) describes external-subtitle synchronization, which is not assumed to control embedded tracks. No unsupported native effect is reported as successful. Audio and subtitle menus include localized language names alongside opaque provider labels.

Browser validation used the repository's public Shaka Angel One HLS sample: 150% captions rendered at 43.2 px versus 28.8 px at 100%, and changing delay while paused changed the displayed cue. Tests cover capability gating, bounds, engine rejection without committing the UI value, per-stream reset and unavailable HTML controls. TV type checks and the full suite pass: **193 files / 3,250 tests**. Rendering performance, caption positioning and protected/native playback still need physical-TV acceptance.

### Recently added discovery

Home includes optional **Recently added movies** and **Recently added series** rows, each with up to twelve distinct titles. Existing saved Home layouts keep their ordering; enable the new rows in Settings → Home screen. New/default layouts include them. Movies and series can also be sorted by **Recently added** in browsing and search. Ties and missing dates retain provider order; undated titles follow dated titles and do not appear in the discovery rows.

Xtream `added` epoch timestamps are normalized from seconds or milliseconds. Series can fall back to `last_modified`; the series row explains that updates may be included. Invalid/future dates, release dates and fetch times are not used as additions. Plain M3U sources have no added-date metadata and retain provider order. Dates survive optional catalog caching and saved provider references. With language grouping enabled, a newly added version promotes its group while the preferred language remains selected. Home uses a bounded top-twelve collector; full-catalog sorting yields and supports cancellation. This remains discovery among the loaded library while provider indexing is incomplete.

### Cooperative downloaded-category indexing (2026-10-03)

Downloaded Xtream categories now stage their title lookup and memory accounting in steps of 512 records, yielding when ten milliseconds of work has elapsed. A category, its search results and title membership publish together. Pause, memory-budget failures and newer loading attempts roll back only their own staged entries; an older canceled run cannot remove a resumed run’s records. Already loaded categories remain available. This extends the existing cooperative saved-catalog restore and cancellable search/sort paths. JSON decoding and parsing still precede staging, and final array publication is synchronous; real-TV performance remains an acceptance item.

Validation: **194 test files / 3,260 tests passed**, plus the TV typecheck. Regression coverage includes 20,000-row staging, cancellation while cleanup overlaps a resumed run, retained membership, character-budget rollback, retries, date parsing/cache round trips and language-group discovery ordering. Browser checks used the local `/_test/large-provider` fixture: 60,000 titles across live/movies/series, newest-first sorting of 20,000 movies, exact search and page 834 of 834 with an undated title last. This is desktop browser evidence, not a TV performance certification. Fixtures contain generated artwork and metadata, no playable media or real provider accounts.

### External text subtitles (2026-10-03)

During a finite, non-live video, open **Playback settings → Load subtitle file**. Enter an HTTP(S) URL or choose a local file if the TV/browser offers a file picker. UTF-8 SRT and file-relative WebVTT load into an app-rendered text overlay. The same 75–200% size and ±5-second timing controls work for that overlay on all player paths. The active engine must successfully turn off its own captions before external captions are enabled; switching back to an embedded track disables the overlay. A failed replacement keeps the previous working external file. The caption area leaves space for the playback controls and settings menu.

This is a bounded text-only reader, not a complete [WebVTT renderer](https://www.w3.org/TR/webvtt1/): it ignores cue styling/positioning, strips supported inline formatting, and displays all other content as literal text. Files are limited to 2 MiB, 20,000 cues, 4,096 characters per cue and a seven-day timeline. At most eight simultaneous cues / 8,192 characters are displayed. Invalid UTF-8, malformed cue timestamps and live `X-TIMESTAMP-MAP` synchronization are rejected. Later checkpoints below add external ASS/SSA text and a separate embedded MP4 reader; image subtitles remain unsupported by this loader.

URL loading has a 30-second deadline, a streamed byte limit and cancellation. Requests omit cookies, referrer, cache and all provider/license headers. A server must allow cross-origin reads; a URL that requires additional authentication must be made accessible by its owner or supplied as a local file. No proxy or header bypass is introduced. Caption text never enters HTML, URLs and file contents are not saved in the library or backups, and pending requests/form contents clear on Back/Cancel or closing the menu. Loaded cues survive closing the menu but clear when playback stops, ends, fails, switches stream or leaves the foreground.

Samsung documents [native external subtitles](https://developer.samsung.com/smarttv/develop/guides/multimedia/subtitles.html) as local files. This implementation uses the shared app overlay rather than downloading into native subtitle storage. Real-TV composition over AVPlay, remote keyboards, local file picking and device performance still need acceptance testing; desktop browser success is not evidence of Samsung hardware support. Existing Shaka embedded-caption controls remain engine-dependent.

Validation: TV type checks and **199 test files / 3,278 tests** pass. New coverage includes cue boundaries/overlaps/backward seeks, malformed files, UTF-8 and streamed byte limits, cancellation/timeouts, credential isolation, native muting failures, late responses, caption exclusivity, size/delay, URL cursor editing, Back/Cancel and session cleanup. Browser verification loaded the local generated WebVTT fixture over the repository's public Shaka Angel One sample, changed the visible cue using a five-second delay while paused and resized it to 150%. Physical-TV and protected-provider playback remain unverified.

### Embedded MP4 text captions (2026-10-03)

Progressive HTTP(S) MP4/M4V/MOV videos can now expose clear `tx3g` caption tracks even when the active player does not list them. Opening Playback settings scans automatically when the engine exposes no subtitle tracks; **Find embedded MP4 subtitles** also offers a manual scan. Found languages appear in the existing Subtitles menu. Selection uses the shared app overlay and its size/timing controls, after successfully silencing the player's captions. Loading a different external file or choosing another track replaces the overlay; Off stops its read-ahead requests. Tracks and byte/cue caches are session-only.

The TV reader follows the same range-read approach as the original Android `mp4-subtitles.ts`, with a separate bounded parser. It reads the MP4 `moov` metadata in a local worker and expands only clear text sample tables. It supports ordinary/64-bit box and chunk offsets, fixed/variable/compact sample sizes, chunk and timing runs, signed composition offsets, and unit-rate edit lists with leading gaps, trims or repeated sections. Mapping uses the documented [sample-to-chunk structure](https://developer.apple.com/documentation/quicktime-file-format/sample-to-chunk_atom) and [edit-list timeline](https://developer.apple.com/documentation/quicktime-file-format/edit_list_atom). Audio/video sample tables are skipped. Caption sample text is decoded as UTF-8 or BOM-marked UTF-16 and rendered literally; embedded formatting is ignored.

Metadata limits are 32 MiB, 256 top-level boxes, 4,096 parsed container children, 128 tracks, 16 supported subtitle tracks, 20,000 samples per text track and 50,000 original/mapped samples overall. Parsing runs in a terminable worker with a ten-second deadline. Subtitle loading reads the current position minus five seconds through the next 45 seconds, with up to three concurrent ranges, 128 requests and 2 MiB per window. Reads have 15-second individual and 45-second operation deadlines. A bounded 2,000-sample / 2-million-character cache avoids repeated reads. Seek changes cancel obsolete windows; read-ahead preserves size/timing settings. Failures expose Retry without failing the video, and closing a pending replacement preserves the previous track's read-ahead.

The server must honor byte ranges and permit cross-origin reads. Visible Content-Range, file sizes and ETags are checked; a hidden Content-Range is tolerated with status/body-length checks. Whole-file 200 responses are cancelled. Browser-supported stream headers are preserved, credentials/referrer are omitted, and header-bearing redirects are rejected to avoid forwarding provider secrets. Required restricted headers, explicit DRM sources, encrypted/non-tx3g subtitle entries, external MP4 data references, fragmented MP4 and non-unit-rate edits are unsupported by this reader. It does not decrypt media, use license headers, launch a proxy or access private TV files. Engine-provided subtitles remain available independently.

Validation: **202 test files / 3,293 tests** and TV type checks pass. Coverage includes actual synthetic MP4 tables, malformed lengths/counts/runs, compact sizes, UTF-16, 64-bit offsets, edit offsets, hidden/mismatched ranges, changed files, caches, cancellation/deadlines, stale reads after seeks, retry, track exclusivity and presentation continuity. The original Android's 66 subtitle tests still pass using the shared fixture builder. Browser testing used a locally generated 70-second H.264 video with English/French tx3g captions and exercised discovery, selection, seeking and track switching. Physical LG/Samsung worker execution, decoder/compositor behavior and real-provider reads remain unverified.

To generate this optional media fixture using an existing FFmpeg installation, run `node scripts/create-tv-mp4-fixture.mjs <path-to-ffmpeg>`, then start the preview with `--fixtures`. Open `http://127.0.0.1:<preview-port>/_test/subtitled.mp4` as a direct source. The generator creates its own plain-color video and captions; it downloads no media or software. Neither generated media nor the local fixture-only tools ship in the TV packages.

### Automatic track languages (2026-10-03)

Saved audio and subtitle languages now apply when matching tracks become available after playback has started. Exact regional tags take priority over primary-language fallbacks; ISO three-letter aliases are recognized. Automatic audio follows the device language, and Automatic subtitles follow the preferred audio language. An already active matching track is retained. Each preference makes one successful selection per stream; a manual audio or subtitle choice takes priority independently until the next stream. Off continues to silence late default-enabled captions until a manual subtitle choice.

With a saved subtitle language enabled, eligible progressive MP4 videos without exposed native subtitle tracks can discover and select matching embedded text captions without opening Playback settings. Discovery and reads retain the bounds, header restrictions and cancellation rules above. Closing the menu does not interrupt automatic selection or active read-ahead. A manual track change, Off, or an external subtitle load cancels pending automatic caption work; late results cannot override that choice. A failed automatic scan/read is not repeatedly downloaded and can be retried manually. The default Off preference does not initiate background MP4 subtitle discovery.

The existing playback tick notices late native track changes while playing or paused. Open track menus update without moving focus; rebuilding their options is deferred while a keyboard-opened native select popup is active. Tests cover late tracks, temporarily unavailable selections, regional matching, reentrant engine reports, cancellation, manual overrides, stream resets and the integrated MP4/native playback flows. Physical-TV timing and native menu behavior still require device validation.

Validation: **204 test files / 3,303 tests passed**, along with the TV typecheck. No new dependency or external service was added.

### Similar titles and provider card metadata (2026-10-03)

Movie and series details now include the original Android TV's category-based Similar titles flow. Up to twelve distinct titles from the same media kind and source category appear, ordered by provider rating with provider order retained for ties/unrated entries. Xtream uses exact category IDs, including categories with identical display names; playlists use their group labels. Suggestions use the available local catalog and update as indexing finishes. They do not fetch an external recommendation service or assert editorial similarity.

Language grouping follows the user's existing content-language setting within that category. The current title and its grouped language versions are excluded. Opening a suggestion or its Hold OK action adds a bounded, session-only detail trail (20 visits). Back restores the preceding title, season, episode page and focused suggestion before returning to the library. Navigation and background transitions cancel unfinished scans; late detail results cannot replace a new screen. Full-category scans/grouping yield to the UI and support cancellation; only twelve cards are rendered.

Provider release years and ratings now appear on artwork cards and provide fallback detail metadata. Valid five-point ratings normalize to ten when a valid ten-point rating is absent. Missing/malformed facts remain absent. Bounded fields survive bookmarks, encrypted library backups and optional saved catalogs; old cached categories gain their enclosing category ID during restore. The in-memory character budget includes new string fields. Older app versions ignore these optional metadata fields. No account addresses, passwords, headers or keys are added to bookmark records.

Validation: **206 test files / 3,310 tests passed**, plus TV type checks. New coverage exercises category identity, stable ranking, language grouping, cancellation, bookmark/catalog/encrypted-backup metadata, series season/page restoration and stale navigation. Browser checks confirmed remote OK/Back and focus restoration, then loaded the generated 60,000-title fixture and displayed exactly twelve top-rated same-category suggestions. Device memory/performance and vendor remote behavior still require physical-TV testing.

### Rating sorting and independent browsing choices (2026-10-03)

Movies, Series, Search, All streams, Favorites, Watchlist and Recent now keep separate sort, watched, title-language and content-kind choices for the active source. Remembered sources retain these choices after reopening; unsaved sources keep them only in the active session. Reset filters affects the current section. Live TV retains provider channel order. A Home category's View all opens with temporary default filters so saved choices cannot hide its titles; ordinary navigation back to that section restores its saved choices. Queries, selected categories and page positions are session-only, as described below; they are not written to persistent storage.

The new **Rating · highest first** option sorts valid provider ratings ahead of unrated titles, keeping provider order for ties. Grouped language versions use the selected card's rating, so the visible ratings follow the displayed order. Sorting yields and can be canceled on large catalogs. Missing ratings retain provider order with an explanation; no external rating service is contacted.

The bounded, seven-section settings map shares the source's existing library storage budget and optional encrypted-library backup. It stores only validated choices, never queries, arbitrary fields or account information. Existing local choices win per section during a backup merge. Legacy backups remain readable; malformed options are rejected before writes. Storage failures restore the previous saved choices, stale windows cannot overwrite newer choices, and reviewed library cleanup/Undo preserves them. Forgetting a source removes its saved choices.

Validation: **208 test files / 3,319 tests passed**, plus TV type checks. Tests cover stable sorting/cancellation, grouped-rating order, section/source isolation, reset, Home category entry, storage failures/conflicts, legacy/malformed backups, encrypted round trips and cleanup/Undo. Browser checks use the generated 60,000-title fixture; device performance and native select behavior remain physical-TV acceptance items.

### Return to your browsing position (2026-10-03)

Live TV, Movies, Series, Search and saved-list sections remember their current query, selected category, page, focused title/control and scrolling positions while the app is open. Returning from another section, Home, details, playback or a source switch restores that position. Up to twenty sources and eight sections per source are retained in memory, using source lookup IDs rather than account addresses. Queries are bounded to 512 characters. Reloading/closing the app clears these visits; they do not enter local storage, encrypted backups or diagnostic logs. The separate saved sort/filter choices above still survive a restart for remembered sources.

Xtream category restoration uses exact IDs, including duplicate category names. Playlist groups remain exact labels. Removed categories/groups show empty results instead of silently falling back to the whole library. **All categories** explicitly starts a fresh section view, and **Reset filters** clears its query/group and saved filter choices. Home category **View all** keeps its temporary view separate from the ordinary section's position. The selected category is visibly marked in the sidebar. Changing sort/filter/language-grouping or layout settings retains the query/category but resets the old page/focus where the arrangement would differ.

Restoration follows a title's stable lookup ID if its page changes, clamps a shortened result set, and uses a visible fallback when a title or control disappears. Lookup yields and supports cancellation on large catalogs. A partial provider index retains a pending title/page until it becomes available or loading completes. Remote/pointer input, a changed query or new navigation cancels that pending restoration, so later results cannot take over a newer choice. Leaving a section cancels its foreground category/search work. Background/foreground transitions preserve the current browsing position without restarting video.

Validation: **212 test files / 3,327 tests passed**, plus TV type checks. New tests exercise isolated/bounded memory, defensive copies, lookup cancellation, source switching, duplicate category IDs, control/title/scroll restoration, smaller or removed categories, removed playlist groups, partial indexing and late-response navigation. Desktop browser checks returned to **page 417 of 463** within an 11,111-match query on the generated 60,000-title provider, restoring the exact movie and category; remote OK/Back returned from details to that same focused card. Physical-TV remote timing, scrolling and long-session performance remain acceptance items.

### Landscape episode rows and richer provider details (2026-10-03)

Series now use compact landscape episode rows, matching the Android layout more closely. Each row can show a still, episode number/title, runtime, short synopsis, viewing progress and watched state. Existing Hold OK actions remain available. Up/Down continues across the 24-row page boundary; Page/Channel Up/Down jumps pages and focuses the appropriate edge. Returning from playback restores the actual episode, including when Next episode crossed into another page or season. Updating a watched mark preserves row focus.

Xtream episode metadata accepts bounded alternate title, description, artwork and runtime fields. Movie details also use valid `movie_data` fallbacks when `info` is incomplete or malformed. Artwork candidates remain restricted to safe HTTP(S) addresses, descriptions remain literal text, and only a bounded set of backdrop candidates is examined. Runtimes accept validated seconds or clock strings up to seven days; missing/invalid values remain absent. This display metadata never replaces the player's actual seek/resume timeline. The optional numeric runtime survives saved provider references without storing descriptions, artwork addresses or account secrets there.

Validation: **214 test files / 3,332 tests passed**, plus TV type checks. Coverage exercises metadata fallbacks and bounds, inert synopsis text, runtime/reference round trips, progress timeline separation, remote page boundaries, playback returning to an episode on another page and watched-action focus. Desktop browser checks used a generated thirty-episode season to verify page movement, edge focus and switching to an eight-episode season. The fixture contains no playable series media; real-provider playback and physical-TV scrolling remain acceptance items.

### Per-source guide timing correction (2026-10-03)

**Guide timing correction** is available under a source's Guide options and in Settings for the active source. It shifts the programme schedule from −12 to +14 hours in thirty-minute steps; positive values move programmes later. This is separate from **Guide clock time zone**, which only formats time labels. The default is no correction. Remembered sources retain the setting; unsaved sources keep it for the current session and library refresh. Encrypted backups include the bounded setting, while existing source settings win during a restore merge. Malformed stored corrections fall back to zero without hiding the source; malformed backup corrections are rejected before writes.

M3U header and channel `tvg-shift` values are now retained up to ±24 hours, including fractional hours and explicit zero overrides. Their correction adds to the active source's setting. The guide, programme details, progress indicators and playback now/next use the corrected schedule. Day queries are shifted back before the XMLTV worker extracts programmes, so listings crossing midnight are not lost. Corrections invalidate cached results and pending loads cannot publish an obsolete schedule. The existing bounded guide cache and worker/feed limits still apply.

Archive requests reverse the display correction to use the original provider timestamps. Separate `catchup-correction` and provider clock settings keep their existing meanings. Replay still checks provider retention and rejects a future original archive time; correcting a label does not make unavailable content playable. Automatic offset inference is not implemented: the default trusts supplied timestamps, and manual correction is explicit.

Validation: **216 test files / 3,338 tests passed**, plus TV type checks. Tests cover midnight/window edges through the actual XMLTV worker, cached/delayed loads, M3U inheritance and channel overrides, now/next in playback, source isolation, session refresh, storage failure, encrypted-backup round trips and unchanged M3U/Xtream archive URLs. Desktop browser checks on the generated provider verified that a +01:00 correction moved the previous programme into the current slot. No real provider or TV archive playback was used for this check.

### External ASS and SSA text captions (2026-10-03)

**Playback settings → Load subtitle file** also accepts UTF-8 ASS v4+ and SSA v4 files by URL or an available local file picker. The file reader recognizes their contents without relying on an extension or server MIME type. It reads dialogue times in centiseconds and named event columns, retaining commas in the final Text field. The existing subtitle size, timing, Off, native-track switching and playback-session cleanup apply. A malformed replacement leaves working captions active.

This is a plain-text fallback, following the original application's ASS text-extraction approach rather than reproducing full typesetting. Structure and text rules follow the [libass file-format guide](https://github.com/libass/libass/wiki/ASS-File-Format-Guide) and [Aegisub override-tag documentation](https://aegisub.org/docs/latest/ass_tags/). Hard line breaks/spaces and soft breaks with WrapStyle or `\q` are retained. Override comments, fonts, styling, positioning, animation and karaoke highlighting are omitted. Content inside drawing mode is suppressed until text mode resumes; drawings do not appear as coordinate commands. HTML and entities remain literal text. Attached fonts/images and picture, sound or command events are ignored without fetching or executing them.

The reader requires a supported ScriptType and an Events Format with unique Start/End fields and Text last. ASS2/v4++, missing or ambiguous event formats, invalid times, unterminated overrides and over-limit input are rejected. Existing file, text, timeline and overlap limits remain in force, with at most 20,000 dialogue events (including drawing-only events), 64 sections and 16,384 characters per input line. Parsing yields and can be cancelled; external URLs retain the credential/header isolation described above. This does not add embedded Matroska extraction, bitmap captions or a full ASS renderer.

Validation: **221 test files / 3,363 tests passed**, plus TV type checks and the packaged C1 startup checks for all three targets. New coverage includes ASS/SSA versions, field ordering, Unicode, comma-bearing dialogue, cue boundaries/overlaps, line breaks, drawing suppression, inert markup/attachments, malformed inputs, bounds, cancellation, local files and the integrated playback controls. The desktop browser loaded the generated ASS fixture over the local H.264 video, switched from embedded MP4 captions, displayed 150% text, moved from cue 4 to cue 3 with a five-second delay while paused, and switched back to embedded English. A TV-width layout check kept captions clear of the settings panel. Real-TV rendering remains an acceptance item.

For the optional fixture, start the preview with `--fixtures`, play `/_test/subtitled.mp4` as described above, then load `http://127.0.0.1:<preview-port>/_test/captions.ass`. Generated media and captions are never included in TV packages. No dependency or external service was added.

### Remote settings choice dialogs (2026-10-03)

Settings now opens an app-rendered choice list, closer to the original Android TV settings dialog. The current value has a check mark, the highlighted row has the app's focus outline, and accent choices include color swatches. Moving the highlight does not change preferences; OK or a pointer selection commits the choice. Back/Escape and Cancel dismiss the list without changing the value and return focus to the setting. Up from the first choice reaches Cancel, and Tab stays inside the modal. Page/Channel Up/Down moves eight available options; Home/End reaches the list edges. Disabled/hidden options are excluded from navigation.

The existing select controls and input/change handlers still own each preference, including source-specific guide correction. Repeated OK presses cannot immediately reopen a just-committed choice. Changes to an open list or its availability close it, and stale option references cannot overwrite a newer value. Navigation and background transitions dismiss pending choices. Lists are limited to 200 options; controls outside Settings, oversized/multiple selects and environments without the modal API retain their native behavior. The modal follows theme, text size, screen margins and direction, using local CSS without a new dependency.

Validation: **223 test files / 3,372 tests passed**, plus TV type checks and packaged startup checks for all three targets. Tests cover value/commit separation, focus restoration, both LG/Samsung Back key codes, held OK, pointer opening, inert labels, disabled groups, list paging, stale choices, translated modal text, existing preference persistence and lifecycle/navigation cleanup. Actual browser checks committed an accent with remote-style keys, cancelled a long time-zone list without changing its value, opened a chooser with a pointer, and kept the modal within the display at 130% text size with 8% screen margins and the light theme. Physical-TV remote and modal rendering still require acceptance testing.

### Update channel and preference preservation (2026-10-03)

Settings now includes **Update channel**, using the remote choice dialog. **Stable** is the default and excludes GitHub prereleases; **Beta** includes both stable releases and prereleases. App updates states the selected filter and labels prerelease links. This choice filters the fork's published packages; it does not switch the installed app, fetch another source branch or install an update. The separate developer-branch revision check keeps its existing meaning.

Checks still run only on request, examine at most twenty public releases and display up to ten matching packages. Channel and TV-platform filtering now precede that display limit, so earlier prereleases or packages for another platform cannot hide a later eligible entry within the response. Returning after changing channels clears the previous results. Android installers and explicitly unsigned Samsung archives remain excluded. Existing fixed-endpoint, credential-free, bounded and cancellable requests are unchanged; a matching package filename still does not establish signing or hardware compatibility.

The channel survives restart and optional preference restore from encrypted backups. Older preferences/backups without the field default to Stable. Changing a preference now preserves unrelated validated preferences, fixing an existing bug that reset legacy Home-row choices when changing appearance or language. Explicit Reset preferences still restores defaults.

Validation: **223 test files / 3,376 tests passed**, plus TV type checks. Regression coverage includes late stable/platform matches, the ten-row bound, prerelease labels, stale result clearing, cancellation, persisted/legacy channels, backup migration, and keeping custom Home rows while changing real app settings. Desktop browser checks selected Beta with remote-style keys, retained it after reload, then restored Stable and opened the manual update check. Physical-TV acceptance remains pending.

### Complete selected guide days (2026-10-03)

The XMLTV reader previously clipped single-channel requests to its default 36-hour future horizon even when a later calendar day was selected. The oldest past day could also lose its morning listings at the rolling seven-day cutoff, and schedule corrections could move valid raw timestamps outside those limits. Per-channel extraction now honors the selected window, bounded to ten days before and seven days after the current raw clock. This allows the existing seven-past/two-future-day picker, calendar boundaries and combined source/channel corrections to work together. The same selected-window handling fixes the oldest calendar day in Xtream API results.

The whole-feed snapshot and implicit XMLTV queries retain their previous smaller horizon; selected queries still read only one channel. Invalid/reversed/nonfinite windows are rejected, distant windows outside the bounds return no results, and the portable guide retains its 512-programme display budget, bounded response sizes, caches and cancellation. Archive requests still use original provider timestamps and retention checks; extra guide visibility does not create archive availability.

Selected dates now show the programme count and date when nothing is currently airing, instead of labeling past listings “Coming up.” An empty selected date says **No listings for this date**. The optional local XMLTV fixture supplies hourly programmes from ten days ago through five days ahead so day navigation can be demonstrated; these generated listings never enter a TV package.

Validation: **225 test files / 3,384 tests passed**, plus TV type checks. New regressions first reproduced the missing listings, then verified plain/text/gzip worker paths, default versus selected windows, clipping and invalid input, extreme combined corrections, provider API calendar edges, and the actual app date picker/status/cache behavior. The desktop browser displayed all 24 hourly listings two days ahead and on the oldest selectable past day, including midnight and the final hour. Physical-TV and real-provider acceptance remain pending. Automatic time-zone inference has not been added; sparse schedules alone do not establish a provider's actual time zone.

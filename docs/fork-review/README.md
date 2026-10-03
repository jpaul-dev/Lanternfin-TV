# Lanternfin TV security review and fork roadmap

Reviewed October 2, 2026, America/Denver. Machine timestamps in the evidence use October 3 UTC. Source package version: 1.9.0.

**Follow-up:** The GitHub fork now exists at [jpaul-dev/Lanternfin-TV](https://github.com/jpaul-dev/Lanternfin-TV). Its verified base is `1efcc1b4ab3468db04aedd1c466228c52ef001b7`; all 907 reviewed files match that base, allowing line-ending differences in three files. This report preserves the original review results. See [fork notes](../../FORK_NOTES.md) for subsequent changes and build status.

The project is a viable starting point for a standalone TV player. It already contains browsing, playlist login, live TV, movies, series, EPG, and remote navigation. The immediate receiver-first launch behavior has been corrected locally. LG webOS and Samsung Tizen are feasible additional targets, but require platform-specific playback, packaging, storage, navigation, and browser compatibility work.

The targeted source review found no clear evidence of deliberate malware, and a Windows Defender custom scan of the source snapshot reported no threats. There are nevertheless concrete credential-handling problems, known vulnerable dependencies, and inherited publishing identities that should be addressed before distributing this fork. This is a scoped review, not a guarantee that every dependency or release binary is safe.

## Completed work and current limits

- Inventoried 907 source snapshot files, including the native Rust and Android code, workflows, packaging, the metadata proxy, binary assets, and a minified dependency patch.
- Inspected installation hooks, outbound services, native process execution, receiver authentication, local storage, application permissions, and representative handling of remote content. Pattern searches found no obvious miner, credential-stealer, security-tool disabling, scheduled persistence, or embedded private-key patterns. Such searches do not establish absence.
- Scanned the source archive with Windows Defender, with remediation disabled. Result: no threats, exit code 0. Engine signatures: 1.459.522.0, updated October 2. This scan did not cover all downloaded package contents or a separately supplied release installer.
- Queried npm advisories for both lockfiles, and OSV for 619 crates.io package versions in Cargo.lock. Inspected the returned dependency paths and advisory details.
- Verified both bundled Microsoft HEVC AppxBundle signatures as valid, with Microsoft Corporation as signer.
- Changed standalone TV startup and added 10 behavior tests. The complete frontend suite passed: **145 files, 2,979 tests**. The static application build succeeded with 27 pages. Changed-file lint had no errors; existing warnings remain.
- No Android APK or native desktop binary was built. No physical Android, LG, or Samsung TV was tested. No dynamic network capture, penetration test, fuzzing, or independent binary-to-source comparison was performed. Android's fully resolved Gradle dependencies and the proxy's transient CLI dependencies were not audited.
- No GitHub fork, public repository, store listing, deployment, or finished rebrand has been created. The supplied folder has no `.git` directory, so its exact upstream commit is unverified.

## Local standalone launch change

Originally, `src/layouts/Layout.astro` detected a TV and wrote both `xt_receiver_mode=1` and `xt_receiver_boot=1` when unset. The next block redirected to `/receiver` before the normal `/tv` routing could take effect. The README's full-app description therefore did not match this fresh-install path.

`src/components/ReceiverDefaults.astro` now runs before routing in both layouts. Missing preferences default to off. Preferences carrying the upstream `_auto` marker are reset to off, and the markers are removed. `app-settings.js` clears these markers when the user changes the receiver settings. TV detection also runs even when performance preferences already exist.

Acceptance cases covered by tests: fresh TV startup opens `/tv`; existing performance preferences do not defeat detection; automatically enabled receiver settings migrate from both entry routes; explicit unmarked receiver choices survive; receiving without receiver boot remains possible; desktop startup remains on its home page; explicitly selected kiosk builds are preserved; unavailable browser storage is tolerated.

One migration limitation: upstream did not remove `_auto` markers after later manual choices. A previously manual choice with a stale marker will be reset once; the user can re-enable it. An independently identified fork will normally start with separate app storage anyway.

Casting code has not been deleted. The standalone playback implementation imports the engine abstraction from `src/scripts/receiver/engines.ts`, so deleting the receiver directory would also break standalone playback. Extract that shared player interface before pruning optional receiver features. The existing release workflows still build separately selected receiver packages.

## Security findings

### High priority credential transport

**Confirmed behavior:** `src/scripts/lib/creds.js:767` tries both schemes when resolving an Xtream server, including HTTP after an explicitly supplied HTTPS URL fails. `resolveM3UScheme` at line 828 follows a similar pattern for playlist URLs, which can contain credentials. `testXtreamConnection` constructs the provider request with username and password query parameters. The source comment describing HTTPS as mostly cosmetic is incorrect: TLS protects the path, query, and headers in transit.

An on-path attacker who can disrupt HTTPS may cause the fallback to expose credentials in cleartext. Missing-scheme URLs also commonly try HTTP first. Android permits cleartext and mixed content globally, which accommodates HTTP providers but does not protect those credentials.

**Required fix:** prefer HTTPS for missing schemes; do not silently downgrade an explicit HTTPS URL; allow an HTTP-only provider only as an explicit per-provider choice. Test TLS failure, timeout, redirects, credential-bearing playlist URLs, and HTTPS-to-HTTP downgrade prevention. Do not globally ban HTTP without accounting for legitimate local and legacy sources.

### High priority credential storage

**Confirmed behavior:** `src/scripts/lib/creds.js:282` serializes the full playlist state, including passwords, to localStorage and a JavaScript-readable cookie, even when the native store succeeds. The cookie at line 107 has `path=/` but no Secure or SameSite attribute. The native store is a JSON file, not demonstrated encrypted secret storage. Backup exports include credentials by design.

In a hosted web build, the browser can attach that cookie to same-origin requests; scripts running in the app origin can read the secrets. Native app sandboxing helps against unrelated applications but does not make localStorage a secret vault.

**Required fix:** remove credentials from cookies and expire the old cookie; use platform secret storage where available; stop mirroring native secrets into localStorage; separate preferences from credentials; label sensitive backup exports and offer encryption. On TVs without a suitable secure-storage API, document the actual protection and minimize persisted secrets instead of claiming encryption based on a key embedded in JavaScript.

### Medium priority receiver exposure

**Confirmed behavior:** `src-tauri/src/receiver.rs:1550` binds the optional receiver to `0.0.0.0`. Its HTTP/WebSocket protocol is unencrypted. Pairing uses expiring, single-use codes with throttling and lockouts, and subsequent controls require a random device key. These are meaningful protections; the receiver is not an unauthenticated remote shell.

The key returned during pairing, stream URLs, and later commands can still be observed by an attacker able to intercept LAN traffic. WebSocket authentication places the key in the query string (`receiver.rs:2164`). Paired senders can also retrieve receiver logs. Subnet scanning and mDNS discovery are consistent with the documented casting feature.

**Status:** automatic enabling is fixed locally. For an optional future receiver, retain explicit opt-in, visible pairing and revocation, a narrow listening policy, and a secure transport/pairing design. A pure standalone TV package should omit the listener after the shared playback code has been separated.

### Medium priority desktop permissions

**Confirmed configuration:** `src-tauri/tauri.conf.json:32` disables the content security policy. The asset protocol and desktop filesystem capabilities include `$HOME/**`, while the HTTP capability accepts arbitrary HTTP and HTTPS URLs.

Those permissions are compatible with a flexible media player, but increase the damage a renderer injection could cause. This review did not demonstrate an exploitable injection or arbitrary remote code execution in the application. Numerous inspected rendering paths escape text or use DOMPurify; the isolated stream-sniffer window has a narrow reporting capability rather than the main window's permissions.

**Required fix:** introduce a tested CSP, constrain filesystem access to app data and user-selected folders, and validate native command arguments at the native boundary. Preserve access to explicitly configured local provider servers rather than applying a universal public-IP-only rule to playback.

### Release blocking inherited update and service identities

The updater still trusts the original publisher's public key and release endpoints in `src-tauri/tauri.conf.json`. Other update paths and allowlists live in `src/scripts/lib/update-check.ts`, `src-tauri/src/updater.rs`, and `src/scripts/make-latest-json.mjs`. These signed upstream updates are not evidence of malware, but a fork must not accidentally install an original-project release over its own application.

TheTVDB lookups go to `https://xt-tvdb-proxy.infinitel8p.com` by default (`tvdb-proxy.ts:19`), exposing requested titles or IDs and the network source IP to that service. Optional TMDB calls use a user-provided key; optional Discord presence shares the current title via the local Discord client. Other expected contacts include GitHub updates, artwork hosts, iptv-org logo lookups, and YouTube trailers. No general-purpose analytics or advertising SDK was identified in the inspected first-party code.

**Required fix:** disable inherited update installation until the fork has its own keys and endpoints; replace all alternate update paths together. Disable the original metadata relay until a licensed fork-owned service or a user-configured alternative exists. Update the privacy policy to describe the fork's actual operator and data flow.

### Executables and installation behavior

The bundled files are:

| Asset | Signature | SHA256 |
| --- | --- | --- |
| HEVCVideoExtension 2.0.61931.0 | Valid Microsoft Corporation | `fbcfbc9ed5c1777946b0dad7a5813377960a134e9907d3e0669804d273defe90` |
| HEVCVideoExtensions 2.4.87.0 | Valid Microsoft Corporation | `57725a8b4f8e7aa1461d463cfa40456ac1082e488f46f1630f627d5c0bd1ba28` |

The first hash matches the application's pinned codec download. The frontend asks before downloading and installing it; Rust invokes `Add-AppxPackage` with a path supplied through an environment variable. This is identifiable codec installation, not evidence of covert persistence. Signature validity does not grant redistribution rights. Prefer a Microsoft Store link in the fork and exclude these installers from new release artifacts unless redistribution rights are established.

Other inspected process launches have identifiable purposes: FFmpeg for media conversion, VLC/MPV for external playback, registry/process queries for detection, and a user-triggered elevated firewall repair. The NSIS hook removes app-specific firewall rules during uninstall; it does not silently open them on install. No root npm preinstall/postinstall hook was present.

`ensure-ffmpeg-sidecar.mjs` fetches upstream FFmpeg builds and verifies pinned hashes, but also supports local binary overrides, a recent verification marker, and a fallback to PATH's FFmpeg. Those development conveniences weaken reproducibility and should be forbidden in release builds. Build and host the fork's own pinned sidecars, preserve applicable LGPL notices and corresponding source/build material, and verify the actual compiled configuration.

The minified `patches/mpegts.js.patch` was compared at the character level. The five changes concern AC-3/E-AC-3 detection and disabled audio source-buffer handling; no new remote endpoint or unrelated code loader appeared in those differences. This was not a complete independent audit of the upstream media library.

## Dependency advisory results

These are registry/OSV advisory matches against locked versions, not proven exploit counts. The app and documentation trees overlap and must not be summed as unique vulnerabilities.

| Tree | Critical | High | Moderate | Low |
| --- | --- | --- | --- | --- |
| Main pnpm lockfile | 0 | 11 | 8 | 5 |
| Documentation pnpm lockfile | 1 | 10 | 8 | 4 |

The documentation tree locks Astro 7.2.4. The critical advisory concerns AVIF image processing through its Sharp image service; it requires untrusted image optimization to be reachable. It is not evidence that the installed TV player exposes an Astro server. The advisory identifies Astro 7.2.8 as the first fixed release. [Astro security advisory](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2).

Main-tree upgrade candidates from the audit are image-size 2.0.2 to at least 2.0.3, undici 8.10.0 to at least 8.10.2, brace-expansion 5.0.9 to at least 5.0.12, devalue 5.9.2 to at least 5.9.3, and DOMPurify 3.4.14 to at least 3.4.16. Resolve these through compatible parent updates and fresh lockfiles, then retest; do not blindly force incompatible dependency versions. The registry reported no patched http-cache-semantics version for GHSA-ch52-4w7c-c8xp at scan time.

Most high findings arrive through Astro/build tooling, jsdom/test tooling, or ESLint. DOMPurify is shipped to the renderer, but its matched advisory requires an in-place sanitization mode plus a node-removing hook; that configuration was not identified in the inspected call sites. A static frontend build has different exposure from a publicly reachable development or server-rendered deployment. Do not expose the LAN-bound development server as a production service.

OSV matched eight Rust packages: two vulnerability-bearing packages and six maintenance notices. `rustls 0.23.43` has RUSTSEC-2026-0285, fixed in 0.23.45; `glib 0.18.5` has RUSTSEC-2024-0429, fixed in 0.20.0. The glib GHSA is an alias of the same issue, not a second finding. The other matches mark proc-macro-error and five unic packages as unmaintained. The lock includes platform-specific packages, so these do not all ship on every target. Upgrade through Tauri/GTK dependency constraints, and confirm reachability per platform. [rustls advisory](https://rustsec.org/advisories/RUSTSEC-2026-0285.html), [glib advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).

No dependency versions were changed during this review. Raw results are in [npm-audit.json](npm-audit.json), [docs-npm-audit.json](docs-npm-audit.json), and [cargo-osv.json](cargo-osv.json).

## Fork identity and licensing

**Working name: Lanternfin TV.** It suggests light, discovery, and a small friendly guide to a large library. A fresh visual direction could use a simple lantern-shaped screen and a warm amber focus accent. The name was provisionally searched, but uniqueness, trademark availability, domains, and store availability have not been established.

The repository declares GPL-3.0-or-later. Preserve upstream copyright and license notices, identify modifications and dates, keep the distributed derivative under the applicable GPL terms, and make complete corresponding source and build instructions available with releases. Attribution alone does not replace these obligations. Evaluate any installation-information obligations and distribution restrictions against the actual store delivery model; this review does not establish store/GPL compatibility. [GNU GPLv3](https://www.gnu.org/licenses/gpl-3.0.html), [GNU license FAQ](https://www.gnu.org/licenses/gpl-faq.en.html).

Use an About notice such as: “Lanternfin TV is an independent fork of Extreme InfiniTV by Ludovico Ferrara / InfiniteL8p and contributors. Original copyright (c) 2025 Ludovico Ferrara. Licensed under GPL-3.0-or-later. This fork is independently maintained.” Link the original project and the exact source for the installed fork release. Do not imply upstream endorsement. Do not remove third-party credits merely because their names are trademarks.

Before distribution, complete this identity inventory:

| Area | Files or locations | Required change |
| --- | --- | --- |
| Product identity | `tauri.conf.json`, `package.json`, Android strings in all locales, layouts, About screens | New product name, publisher, descriptions and icon set; retain upstream attribution separately |
| Install identity | Android applicationId/namespace and Java packages; Tauri identifier; MSIX manifest; Linux packages | Fork-owned identifiers and signing certificates, chosen after GitHub owner/domain is known |
| Artwork | `src-tauri/icons`, Android banner/splash resources, `public/favicon.svg`, embedded logo SVGs, documentation screenshots | Original artwork; replace upstream promotional screenshots with the fork's own lawful demo material |
| Updates and releases | Updater config, Rust allowlist, frontend checks, release/beta workflows, sidecar downloader, latest manifest generator | Own signing keys/endpoints and deterministic release inputs; independent versioning |
| Accounts and services | TVDB Worker and Cloudflare config, Discord application ID, store IDs, donation/community/support links | Fork-owned accounts or disabled integrations; no silent dependence on the original operator |
| Policies and credits | README, privacy policy, terms, security contact, About licenses, source release | Preserve required notices; replace claims that the fork is operated by the original author |

The Microsoft codec installers are a redistribution-rights question in addition to branding. TheTVDB data access also has its own licensing and attribution terms; an open-source code license does not transfer the original operator's service agreement or API account. Maintain TMDB and other library notices when retaining those integrations. [TheTVDB API licensing](https://thetvdb.com/api-information).

For the eventual GitHub fork, preserve upstream history: create a fork of `infinitel8p/Extreme-InfiniTV`, clone it with a separate `upstream` remote, select and record an immutable base commit, compare this archive against that commit, then apply the local startup patch. Do not manufacture upstream authorship by treating the ZIP import as the original history. Keep publishing workflows disabled until the identity inventory is complete. The local [fork notes](../../FORK_NOTES.md) already preserve the original credit and describe the current modifications.

## LG and Samsung feasibility

The reusable portion is the web UI and domain logic: Xtream/M3U parsing, EPG, categories, search, favorites, watch progress, and much of the remote-navigation work. Tauri's Rust services, Android ExoPlayer activity, FFmpeg sidecars, OS file dialogs, updater, and Android JavaScript bridges do not transfer directly to a TV web package.

| Target | Proposed package and player | Main work |
| --- | --- | --- |
| Android TV | Existing Tauri Android package and native Media3 player | Stabilize standalone startup, harden credentials, rebrand/sign independently, test remote-only onboarding |
| LG webOS | Packaged web app with `appinfo.json`, delivered as `.ipk`; native HTML video/media capabilities | WebOS lifecycle and Back/Magic Remote handling, persistent storage, media/track support, compatible routing/assets, platform testing |
| Samsung Tizen | Signed web app with `config.xml`, delivered as `.wgt`; Samsung AVPlay | AVPlay lifecycle and events, video plane and overlays, remote key registration, subtitle/audio selection, suspend/resume and certification |

LG documents packaged and hosted web applications. Samsung documents AVPlay's native playback controls and state transitions; the adapter should use asynchronous preparation to avoid freezing the UI. Exact codecs, stream variants, DRM, audio tracks, and subtitles must be checked on the supported models. [LG app types](https://webostv.developer.lge.com/develop/getting-started/web-app-types), [LG streaming specifications](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm), [Samsung AVPlay guide](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html).

### Browser compatibility is a first milestone

The source uses Tailwind 4, modern CSS, Svelte 5, and Astro's client navigation. Tailwind's documented baseline includes Chrome 111. LG's published web engines are Chromium 87 for webOS 22, 94 for 23, 108 for 24, and 120 for 25. Samsung lists Chromium 85 for 2022, 94 for 2023, 108 for 2024, and 120 for 2025. Therefore even many 2024 TVs are below the styling framework's baseline. Lowering the JavaScript compilation target alone will not fix CSS support. [Tailwind compatibility](https://tailwindcss.com/docs/compatibility), [LG engines](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), [Samsung engines](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

Proposed policy, pending actual hardware: prove playback and navigation first on one current LG and Samsung device; aim for **2022 and newer** through a dedicated compatible TV stylesheet/build; certify only the OS/model combinations actually tested. Supporting older sets is a separately estimated phase. Modern firmware may change an individual TV's engine, so record OS and firmware, not just the label year.

### Shared architecture to build toward

Extract the existing `ReceiverEngine` abstraction into a general player interface. Give Android, the desktop/browser, LG, and Samsung their own implementations for play, pause, seek, track selection, state/error events, and teardown. Keep casting transport independent of that interface.

Introduce small platform adapters for provider requests, credential storage, remote input, app lifecycle, external links, and supported capabilities. Hide unavailable features through those capabilities. The TV domain code should not import Tauri or Android bridges directly.

Package a self-contained TV shell that launches into browsing and can accept a playlist using only the remote. Resolve the existing root-relative `/tv/...` links, `/_astro/...` assets, workers, and Astro page-fetch navigation against packaged app origins. Prove this in an installable package before investing in visual polish; a working desktop web preview is not proof that `file:` or widget routing works.

Test provider transport early: playlist/API requests and native video playback may use different network stacks. Validate CORS/origin behavior, HTTPS certificates, redirects, cookies, Authorization, custom User-Agent/Referer, and segmented stream requests on each platform. Do not assume Tauri's native HTTP behavior survives the port. Favor direct playback; consider an optional user-controlled relay only for demonstrably unsupported providers, never a required phone or an unrestricted public proxy.

Use IndexedDB or an appropriate platform store for larger catalogs and progress, with deliberate retention limits. Do not port the credential cookie fallback: LG explicitly documents that packaged web apps do not support cookies. [LG web engine and storage notes](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine).

### Initial release scope

Include remote-only playlist login, Xtream and M3U sources, live channels, EPG, movies/series, search, favorites, resume progress, subtitles/audio selection where supported, and honest playback errors. Start the media matrix with H.264/AAC HLS and MP4. Add MPEG-TS, HEVC, AC-3/E-AC-3, DASH, and other combinations only after device validation.

Defer casting/receiver servers, downloads, FFmpeg conversion, desktop external players, arbitrary website sniffing, desktop-style file management, and a generalized DRM promise. LG and Samsung do not inherit the desktop's ability to repair unsupported media with an FFmpeg process. Media that requires conversion needs a supported source rendition or a separately designed optional server.

## Delivery plan and effort

These are engineering estimates, not vendor timelines. Assume one experienced developer, access to real TVs, a legal stream test set, direct playback for the first release, and no new subscription backend or broad legacy-device support.

| Phase | Estimated effort | Exit condition |
| --- | --- | --- |
| Fork and hardening | 1 to 2 weeks | Verified upstream base; independent identities; safe update/service defaults; critical dependency and credential issues addressed; signed standalone Android test package |
| Shared TV shell and compatibility | 2 to 3 weeks | Packaged startup on both TV brands; player/platform interfaces; working remote login and navigation; 2022-browser compatibility strategy validated |
| LG playback and integration | 2 to 3 weeks | Installable LG alpha; catalog, live and VOD playback, progress, tracks, remote behavior, suspend/resume demonstrated on hardware |
| Samsung playback and integration | 2 to 4 weeks | Signed Samsung alpha; AVPlay state/overlay/track behavior and remote flows demonstrated on hardware |
| Device testing and release preparation | 2 to 4 weeks | Supported-model matrix, long playback runs, failure recovery, source/notices, privacy and store submission material ready |

Total planning range: **9 to 16 developer-weeks**, plus store review and any dependency/API licensing delays. Older TVs, broad provider compatibility, commercial DRM, or transcoding could extend this materially. Re-estimate after a **3 to 5 day packaged playback spike**, included in the shared-shell phase, that tests one real LG and Samsung plus representative provider requests. That experiment should decide the practical minimum TV version before a larger UI migration.

The first implementation milestone should be a clearly branded, signed Android TV build that opens its own catalog, works with casting disabled, and has the high-priority security changes. Then reuse that tested domain behavior across the LG and Samsung adapters.

## Hardware and publication acceptance

Test clean installation and upgrades, remote-only onboarding, Back/Home/media keys, Magic Remote pointer-to-focus transitions, keyboard entry, no-network startup, lost network during playback, app suspension/resumption, rapid channel changes, large catalogs, EPG memory use, long playback, subtitle/audio switching, deletion of saved credentials, and log/backup redaction. Confirm no receiver port opens on a default install and that a paired sender is unnecessary for normal playback.

LG developer-mode installation is a testing path with a limited session; disabled Developer Mode removes its installed test apps. Public distribution goes through LG's app approval process. Samsung installation requires valid signing certificates; certification and seller-region eligibility are separate from getting a `.wgt` to run. Provide lawful demo content and sufficient test accounts for vendor review, accurate supported-device claims, and full corresponding source/licensing material. Store approval cannot be inferred from a successful technical port. [LG developer mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), [LG approval](https://webostv.developer.lge.com/distribute/app-approval-process), [Samsung certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html), [Samsung Seller Office](https://developer.samsung.com/tv-seller-office/guides/overview.html).

## Evidence files

- [Source inventory and hashes](source-inventory.json) and [original contents of the three edited source files](launch-baseline.zip).
- [Portable standalone startup patch](standalone-launch.patch), for applying to a matching upstream checkout after verifying the base commit.
- [Main npm advisories](npm-audit.json), [documentation advisories](docs-npm-audit.json), [Cargo OSV results](cargo-osv.json), and individual Rust advisory JSON files in this directory.
- [Minified media patch differences](mpegts-patch-differences.json).
- [Windows Defender result](defender-scan.log) and [bundled binary signatures and hashes](binary-signatures.json).
- [Targeted tests](targeted-tests.log), [complete tests](full-tests.log), [build result](build.log), and [changed-file lint](changed-lint.log).

Package installation used the frozen lockfile with install scripts disabled. Advisory queries sent package names and versions, not source files or provider credentials, to the registries. The HEVC installers were inspected but not installed. The source snapshot scan archive is retained in the local temporary location recorded in `scan-target.txt`.

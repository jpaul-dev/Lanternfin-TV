# Lanternfin TV alpha builds

The initial target is a standalone Android TV app with browsing and playback on the TV itself. Casting and receiver boot are off on a fresh install. LG webOS and Samsung Tizen packages require the separate port described in the [roadmap](fork-review/README.md).

## Reproducible source and build settings

Check out the exact commit associated with the GitHub Actions artifact. The initial fork base is upstream commit `1efcc1b4ab3468db04aedd1c466228c52ef001b7`. GPL-3.0-or-later and the original copyright notices apply to this derivative.

Toolchain: Node 22, pnpm 10.31.0, Java 17, Rust stable, Android SDK platform 36, build-tools 36.0.0, NDK 29.0.13846066. The repository pins Gradle through its wrapper and JavaScript/Rust dependencies through lockfiles. The CI workflow records the actual Rust toolchain version; a future reproducible-release workflow must pin it too.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
rustup target add aarch64-linux-android armv7-linux-androideabi
export ANDROID_HOME=/path/to/android-sdk
export NDK_HOME="$ANDROID_HOME/ndk/29.0.13846066"
export PUBLIC_APP_MODE=standalone
export XTREAM_TV_BUILD=1
export XT_SKIP_FFMPEG_SIDECAR=1
pnpm tauri android build --ci --apk --target aarch64
pnpm tauri android build --ci --apk --target armv7
```

On PowerShell, use `$env:NAME = 'value'` instead of `export`. Do not set `PUBLIC_APP_MODE=receiver`. The TV flag controls Android launcher requirements; it does not select receiver mode.

## Artifacts and signing

The `Lanternfin alpha` workflow produces a web bundle and two **unsigned** APK artifacts. It has read-only repository permissions and uploads artifacts rather than publishing to an app store. Artifact retention is 14 days. Preserve the source commit with any APK you distribute.

CI does not hold a release signing key. Align and sign a downloaded APK locally with Android SDK `zipalign` and `apksigner`, then verify the signature. Keep any alpha key outside the checkout and backed up. A persistent alpha key allows updates to an installed alpha; a different key requires uninstalling it first. Do not use this alpha identity/key for a store release without deciding the long-term signing strategy.

Install only after confirming the application ID is `io.github.jpauldev.lanternfin`, the label is `Lanternfin TV`, and the launcher opens the browsing UI. Test ARM64 and ARMv7 devices separately. Compilation does not establish playback or remote-control compatibility.

## Alpha limits and release gates

- Credentials still persist in local app storage without an encrypted vault. New saves no longer mirror them to cookies; HTTPS resolution no longer retries over HTTP. Explicit `http://` sources remain supported.
- The original updater key is removed and update links point to this fork. Automatic signed desktop updates are not configured.
- TheTVDB relay has no default endpoint and needs both `PUBLIC_TVDB_PROXY_URL` (HTTPS) and user opt-in. No such service is deployed for this alpha.
- The dependency audit still has unresolved findings; see the review and new audit output. Do not call this a security-cleared release.
- This workflow excludes desktop FFmpeg/HEVC installers. Desktop packaging, inherited auxiliary assets/docs, store identities, and broader branding need a separate release pass.
- Physical Android TV validation, signed store delivery, LG/Tizen packaging, codecs, remote navigation, and store review remain outstanding.

Before the first public release, close the security gates in the review, finish the identity inventory, verify rights to distributed assets, and test real TVs with lawful test media.

# First Lanternfin TV alpha: verified builds

Completed October 2, 2026 (America/Denver; October 3 UTC).

The fork is [jpaul-dev/Lanternfin-TV](https://github.com/jpaul-dev/Lanternfin-TV). The latest application build uses source commit [`8cdabd586d394a075bf068fa0d1226e72f5120ff`](https://github.com/jpaul-dev/Lanternfin-TV/tree/8cdabd586d394a075bf068fa0d1226e72f5120ff). Later documentation-only commits do not change these binaries.

## Results

- [GitHub Actions run 37093029943](https://github.com/jpaul-dev/Lanternfin-TV/actions/runs/37093029943): web, ARM64 Android TV, and ARMv7 Android TV jobs all succeeded.
- Frontend: 146 test files, **2,990 tests passed**; 27-page static build succeeded.
- APK metadata verified: `Lanternfin TV`, application ID `io.github.jpauldev.lanternfin`, version `0.1.0-alpha.1`, version code `501`, Android TV launcher entry, and correct native architecture.
- Artifact archive hashes matched the digests returned by GitHub before extraction.
- Both downloaded APKs were aligned and signed locally with the same independent alpha key. APK signature schemes v2 and v3 verified successfully.
- Windows Defender scanned the downloaded and signed alpha artifacts with remediation disabled: **no threats found, exit 0**. This does not establish absence of malicious or vulnerable behavior.
- Browser inspection confirmed standalone TV home, navigation to settings, and original-author attribution. No real TV installation, playback, network-port capture, or remote-control hardware test has been performed.

## Local outputs

Outputs are under `artifacts/alpha-0.1.0/` in the checkout; binaries are intentionally not committed to Git.

| File | Target | Size |
| --- | --- | --- |
| `Lanternfin-TV-0.1.0-alpha.1-arm64.apk` | Android TV with arm64-v8a | 14,741,317 bytes |
| `Lanternfin-TV-0.1.0-alpha.1-armv7.apk` | Android TV with armeabi-v7a | 13,778,759 bytes |
| `lanternfin-web.zip` | Shared static frontend | Development web bundle |

The same folder contains the build manifest, original unsigned archives, extracted package metadata, signature verification logs, and antivirus output. SHA-256 hashes and public signing-certificate fingerprint are recorded in [the build manifest](fork-review/alpha-build-manifest.json). The [scan result](fork-review/alpha-defender-scan.log) is also retained with local paths removed.

Private signing material is outside the checkout at `%USERPROFILE%\.lanternfin\signing`. Keep it protected. The password file uses Windows DPAPI and is tied to this Windows user/machine; follow the [signing and backup notes](ALPHA_BUILDS.md) before moving to another machine.

## Next milestone

Test clean installation, standalone playlist onboarding, live/VOD playback, D-pad navigation, Back/Home behavior, and no default receiver listener on an actual Android TV. Use lawful test media and test credentials. Keep this as an alpha while the remaining credential-storage, dependency, desktop-permission, and distribution issues in the [review](fork-review/README.md) are addressed.

Initial LG webOS and Samsung Tizen ports are now implemented separately on `ports/webos-tizen`; see [TV port status and installation](TV_PORTS.md). These Android APKs do not install on those systems. TV hardware verification and Samsung signing are still pending.

# Lanternfin TV

A standalone TV player for your own media sources. Open the app, add a playlist, and browse live TV, films and series with your remote. Casting is optional and off by default.

**Status: 0.1.0-alpha.1.** Android TV is the first build target. LG webOS and Samsung Tizen are planned ports, not currently supported products. The working name has not undergone trademark clearance.

## Origin and license

Independent fork of [Extreme InfiniTV](https://github.com/infinitel8p/Extreme-InfiniTV), created by Ludovico Ferrara / InfiniteL8p and contributors. Original copyright (c) 2025 Ludovico Ferrara. Fork modifications (c) 2026 Lanternfin TV contributors. Licensed under [GPL-3.0-or-later](LICENSE). No upstream endorsement is implied. Full upstream Git history and license notices are preserved.

## Builds

[GitHub Actions](https://github.com/jpaul-dev/Lanternfin-TV/actions/workflows/alpha.yml) builds the shared web app and standalone Android TV APKs for ARM64 and ARMv7. CI APKs are **unsigned**; they require your own signing key before installation. They are development artifacts, not store releases. See [build instructions](docs/ALPHA_BUILDS.md).

The Android identity is `io.github.jpauldev.lanternfin`, separate from the original app. The inherited update signing key is removed. There are no inherited store publishing workflows. No upstream metadata relay is contacted by default.

The first web, ARM64, and ARMv7 builds passed; local signed alpha packages have been verified. See [build results and limitations](docs/BUILD_STATUS.md). A physical TV has not yet been tested.

## Review and roadmap

Read the [security review and LG/Samsung plan](docs/fork-review/README.md), and [fork change notes](FORK_NOTES.md). The initial review found no clear evidence of deliberate malware. Remaining work includes encrypted credential storage, tighter desktop permissions, outstanding dependency advisories, physical TV testing, and platform-specific LG/Samsung players.

Do not treat an alpha build as proof of device compatibility or security. Use test playlists first. No playlists, subscriptions, or rights to third-party media are supplied.

## Local development

Use Node 22 and pnpm 10.31.0. Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm test`, and `pnpm build`. The native Android toolchain is documented separately.

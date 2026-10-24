# Lanternfin TV fork notes

Lanternfin TV is an independent, standalone TV player derived from Extreme InfiniTV. The working name has not undergone trademark clearance. The fork is hosted at https://github.com/jpaul-dev/Lanternfin-TV with the original Git history preserved.

The initial base is upstream commit `1efcc1b4ab3468db04aedd1c466228c52ef001b7`. All 907 reviewed snapshot files were compared with this checkout: 904 matched byte for byte, and the three startup files matched after line-ending normalization. The review predates the fork; its findings describe that baseline unless a later note says otherwise.

Original project: [Extreme InfiniTV](https://github.com/infinitel8p/Extreme-InfiniTV), by Ludovico Ferrara / InfiniteL8p and contributors. The original notice is **Copyright (c) 2025 Ludovico Ferrara.** Preserve the upstream notices and the [GNU GPL license](LICENSE). The project declares GPL-3.0-or-later; the proposed fork retains that license.

Local changes dated October 2, 2026 make standalone browsing the default on TV devices. Receiving casts and booting into the receiver are opt-in. Old settings marked as automatically enabled are migrated to off, and subsequent explicit receiver choices clear those automatic markers. The dedicated receiver build remains available through its existing explicit build setting.

The inherited publishing, deployment, funding, and automation workflows were removed on October 2, 2026. Their originals remain in Git history. New build workflows must produce fork-owned test artifacts without publishing to the original author's stores or services. This is an alpha project, not a store-ready release.

Read the [security review and LG and Samsung roadmap](docs/fork-review/README.md) for findings, scan evidence, licensing work, platform scope, and the recommended implementation sequence.

The first LG webOS and Samsung Tizen preview ports are now implemented on `ports/webos-tizen`. See [TV port builds, installation, and remaining milestones](docs/TV_PORTS.md). The Android alpha baseline is unchanged.

## Initial alpha changes, October 2, 2026

- Android and Tauri identity: `io.github.jpauldev.lanternfin`, Lanternfin TV, version `0.1.0-alpha.1`. New vector icon, launcher artwork, banner, splash, and in-app branding. Original author credit remains in About and TV settings.
- Removed the upstream update key; update/release links now identify this fork. Metadata relay access requires an independently configured HTTPS endpoint and explicit user opt-in.
- HTTPS and scheme-less credential URLs no longer fall back to HTTP. Explicit HTTP sources remain usable. New credential saves expire the old playlist cookie instead of writing passwords into it. Local/native storage is still unencrypted.
- Updated compatible dependency versions, including DOMPurify 3.4.16; unresolved advisories remain documented.
- Follow-up patch overrides update undici to 8.10.2, brace-expansion to 5.0.12, and devalue to 5.9.3. The main-tree npm audit now reports one high finding (`http-cache-semantics`), down from 24 advisory records; the docs lockfile and Rust findings are separate outstanding work. Evidence: `docs/fork-review/npm-audit-alpha.json`.
- Added a read-only GitHub Actions workflow for frontend validation and ARM64/ARMv7 standalone Android TV APKs. CI packages are unsigned and are not store releases. See [alpha build instructions](docs/ALPHA_BUILDS.md).

The first complete build run passed. Both Android architectures now have locally signed and verified alpha APKs, and all 2,990 frontend tests passed. See [verified build results](docs/BUILD_STATUS.md) for source provenance, artifact hashes, scan evidence, and remaining hardware checks.

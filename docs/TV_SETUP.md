# Lanternfin TV Setup companion

Double-click **Lanternfin TV Setup** on the Windows desktop, or **Open TV Setup.vbs** in this checkout. It opens a local browser interface; no terminal commands are needed for normal setup. Node.js 22 or newer is required and is already installed on this workstation. If Windows has disabled VBScript, use **Open TV Setup (console).cmd** instead.

The companion is part of the same checkout at `C:\Users\jayco\Desktop\Codex Projects\Lanternfin-TV`. It supports the LG and Samsung development previews in [TV_PORTS.md](TV_PORTS.md).

## Using the guide

1. Choose **LG TV** or **Samsung TV**.
2. **Computer tools** detects the LG CLI, project build tools, app package, and Samsung SDK. Buttons install the pinned LG/project tools if needed. For Samsung, use the official installer link and include Web CLI, Samsung TV Extension, and Samsung Certificate Extension. Enter a custom SDK folder if necessary.
3. **Developer Mode** walks through the settings on your TV. Samsung's page shows this computer's network addresses, with virtual/VPN adapters identified where their names allow detection. Choose the connection on the same network as the TV.
4. **Connect your TV** accepts the TV's private IPv4 address. LG pairs using the six-character code displayed in its Developer Mode app; Samsung uses SDB. The guide waits for a verified connection before enabling installation.
5. For Samsung, **Samsung certificate** explains account sign-in, a Samsung TV certificate profile, the TV DUID, and Device Manager's installation permission. When their launchers are detected, buttons open Certificate Manager, Device Manager, and Package Manager. The companion can list profile names and build/sign the widget using your selected profile.
6. **Install Lanternfin** installs the correct platform package on the selected TV. **Start watching** launches it and provides a short playback/remote checklist.

TV settings, account sign-ins, certificate creation, and the TV's installation permission remain user-operated steps in the vendor interfaces. The guide does not remotely enable Developer Mode or create developer accounts. A CLI success is reported as an accepted operation; the final on-TV picture/sound checks are yours to confirm.

LG development apps can disappear when the Developer Mode session expires. Extend the session in LG's TV app before that happens. Samsung certificates must include the target TV DUID and should be backed up outside the repository.

## What the buttons do

| Button | Action |
| --- | --- |
| Install LG tools | Runs the isolated, locked official LG CLI installation with lifecycle scripts disabled |
| Prepare build tools | Uses pinned pnpm 10.31.0 to install the repository lockfile, with lifecycle scripts disabled |
| Pair my LG TV | Creates a Lanternfin-specific LG device entry, requests its key, and reads TV system information |
| Check existing pairing | Checks the matching saved device and reads TV system information |
| Connect my Samsung TV | Connects SDB to the explicit TV address and checks that serial is in `device` state |
| Build & sign my app | Builds the Tizen app, copies only app assets into a fresh staging directory, and runs the SDK with the chosen profile |
| Install Lanternfin | Checks package identity and installs onto the explicitly selected TV |
| Launch on my TV | Launches this fork's application ID after installation succeeds |

The Samsung signing directory is `artifacts/tv-setup/<unique-id>/.buildResult`. It is excluded from Git. The helper checks for both author and distributor signature XML files and the correct app ID; **the TV performs cryptographic certificate validation**. A changed package must be signed again. It will not install the old unsigned WGT.

## Local access and data handling

- The service binds only to `127.0.0.1` on a random port. Every API action requires a random launch token; Host, Origin, and cross-site requests are checked. There is no general-purpose command endpoint, CORS access, directory browser, or external relay.
- Commands use fixed tools and argument lists. The Samsung Windows batch wrapper rejects shell metacharacters. TV targets are limited to private IPv4 addresses and always selected explicitly; there is no network scan or default-device installation.
- LG pairing codes travel to the CLI over its input pipe, not command arguments. The CLI's device listing and key-exchange output are excluded from the GUI log, because LG's current listing includes a passphrase column. Remaining activity is bounded and redacted.
- **LG's official tools save the TV key and passphrase in their own per-user configuration.** The companion does not save the pairing code in its browser settings or logs. Samsung private keys and account passwords stay in its official tools.
- The current tab remembers non-secret guide choices and checklist progress in session storage. Connection/install verification is held by the local service and is rechecked after a fresh launch. Closing a tab does not immediately stop an active install; use Cancel or Close setup. The service exits after an hour without API activity when no job is running.
- No analytics, automatic firewall changes, background autostart, security-policy changes, or network-wide listener is added. The Windows desktop shortcut is the only desktop integration.

The existing LG CLI dependency advisories in [TV_PORTS.md](TV_PORTS.md#security-and-review-notes) remain relevant. This companion adds no new npm runtime dependencies; it uses Node's built-in modules and local static assets.

## Development and validation

`pnpm tv:setup` opens the companion. For controlled local tests, `node tv-setup/server.mjs --session-file artifacts/tv-setup-session.json` writes an ephemeral local launch token; that file must remain ignored and must not be shared. All setup tests are included in `pnpm test`.

Automated tests cover local API authentication and origin checks, request limits, command allowlisting, private-address validation, Windows batch quoting, code redaction/stdin handling, private CLI output suppression, process timeout/cancellation, LG pairing and identity, and Samsung connection/signature/package changes. The Windows path-with-spaces check executes a harmless fixture batch file. Vendor workflow tests use controlled process doubles, not real televisions or private certificates.

Browser checks cover both walkthroughs, actual local tool detection, missing SDK handling, gated actions, progress/error presentation, and responsive layout. Real pairing, Samsung SDK signing, TV installation, and playback still require the user's TV and Samsung development environment.

Validated source: [`97e8c27`](https://github.com/jpaul-dev/Lanternfin-TV/tree/97e8c27a0f703f4f3ec2e41f065031f55abb8765). [CI run 37107112865](https://github.com/jpaul-dev/Lanternfin-TV/actions/runs/37107112865) passed all 49 setup tests on Windows, the full Linux suite (152 files, 3,068 passed, one Windows-only test skipped), TV type checks, and both package builds. Browser inspection checked the 390-pixel layout and successfully ran **Build latest app** through the GUI. That clean build produced an LG IPK with SHA-256 `34f8236eb6d0dee7836cb7c5ebc4e4b674c66290804c9b6a1a30d34c43e910a7`. Rebuilds can have different archive timestamps; use the accompanying checksum file.

Official references: [LG Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), [LG CLI](https://webostv.developer.lge.com/develop/tools/cli-dev-guide), [Samsung TV connection](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html), [Samsung certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html), and [Samsung CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html).

# Lanternfin phone setup

Live service: https://lanternfin-pairing.jpaul.workers.dev

Choose **Set up with your phone** on Lanternfin's TV sign-in screen. Scan its QR code or open the address and enter the eight-character TV code. Compare the six confirmation digits on both screens, approve the phone on the TV, then choose **The codes match** on the phone. Enter an Xtream account or M3U playlist and optionally an XMLTV guide. The TV opens and saves the source; the phone confirms when the TV has finished.

No computer, phone app installation, shared Wi-Fi network, or Lanternfin account is required. This adds a source to Lanternfin; it cannot sign an independently installed Extreme InfiniTV app in. It does not sync favorites or viewing progress between devices. The TV still needs to reach the provider and meet its playback requirements. Transferring credentials does not bypass provider restrictions, DRM, headers, CORS, or network/proxy configuration.

## Architecture and privacy

- One Cloudflare Worker serves the static phone page and pairing API. A SQLite Durable Object serializes each session's state transitions. There is no provider proxy in this service.
- TV codes have eight characters from a 32-symbol alphabet (40 bits). Each device also holds a separate random 256-bit capability; knowing a code does not grant TV approval or payload retrieval.
- ECDH P-256, HKDF-SHA-256 and AES-256-GCM use the platform's Web Crypto implementation. Private keys are non-exportable. The QR fragment pins the TV public key and is removed from phone history on load. Both clients require explicit confirmation before sending an account. Only an encrypted account envelope reaches the relay.
- One phone can claim a session. The TV approves it before the phone can send one envelope. Associated data binds encryption to the protocol, session and both public keys. The TV validates the account before reporting success. Sessions expire after five minutes, including ones abandoned during network failures. Completion discards the envelope immediately; the remaining status and capability hashes expire with the session. Cancellation deletes the session. Device clocks do not determine server expiry.
- The service never intentionally logs provider credentials, request bodies, pairing codes or tokens. Worker observability is disabled. Responses are not cached; no third-party scripts, analytics or cookies are used. The phone page uses no local/session storage. Cloudflare necessarily handles connection metadata; browser/password-manager behavior is outside the page's control.
- Session creation/claims have per-network rate limiting; polls use per-capability limits. Cloudflare's rate-limit binding is best effort and local to a location, not a strict global quota. Capability checks, atomic transitions and expiry remain independent controls.
- Trust still includes the app builds, the delivered phone JavaScript, HTTPS, Cloudflare and the hosting account. This is not an independently audited cryptographic protocol and does not protect a compromised phone, TV or service deployment. The confirmation check is a user-facing safeguard, not a claim that a malicious host is harmless.
- Provider details are saved by the TV's existing source storage. **That storage is not encrypted by this feature.** Use pairing only with a TV you trust. Credentials are not stored as a cloud account.

TVs need Web Crypto support. Unsupported devices show a useful error and retain manual setup. Packaged LG C1 compatibility checks cover syntax/startup, not the physical TV's cryptographic runtime. Test a real C1 and Samsung TV before calling hardware support verified.

## Development

From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir pairing-service --ignore-workspace install --frozen-lockfile --ignore-scripts
pnpm pairing:build
pnpm --dir pairing-service --ignore-workspace check
pnpm exec vitest run tests/pairing-protocol.test.ts tests/pairing-relay.test.ts tests/pairing-dialog.test.ts tests/xtream-login.test.ts
```

Run `pnpm --dir pairing-service --ignore-workspace dev` and build the TV with `PUBLIC_PAIRING_URL=http://127.0.0.1:8787` for a same-computer demo. HTTP is allowed only for loopback development. A real phone cannot use the PC's loopback URL; use the deployed HTTPS service. Provider credentials are never needed for tests; use the existing local TV fixtures.

## Deploy or self-host

1. Build and check the phone service using the commands above.
2. Sign in through the official Wrangler OAuth flow. The project uses account/profile read and Workers scripts write scopes. Store credentials in the OS keyring where available; never commit tokens. Deployment does not need a separate API token embedded in any app.
3. Choose an unused Worker name in `wrangler.toml` for your own fork. Keep the Durable Object binding and initial SQLite migration. The two rate-limit namespace IDs should be unique within your account.
4. Run `pnpm --dir pairing-service --ignore-workspace deploy`. This creates the Worker and Durable Object namespace. Do not enable paid features or change a billing plan without the account owner's decision. Check Cloudflare usage limits for your plan before a public rollout.
5. Put its HTTPS origin in `src/config/pairing.json`, or set `PUBLIC_PAIRING_URL` at build time. Rebuild Android and all TV targets; an older installed package does not learn the new address automatically. The URL is public configuration, not a secret.
6. Test a session with disposable fixture data through the public service, including cancellation, expiry, incorrect codes and TV-side failure. Then test real devices. Custom-domain routing is optional; the workers.dev address works as-is.

Rollback uses Cloudflare Worker version rollback and the previous signed app packages. Deleting the Worker or namespace would invalidate pending sessions and is unnecessary for routine rollback. Do not turn on request-body logging when investigating pairing problems.

## Validation at initial implementation

The complete local Worker/phone/TV browser flow transferred a fixture playlist, saved it on the TV and showed success on the phone. Automated coverage includes encryption round trips, tampering, wrong-session keys, QR key pinning, concurrent claims, role authorization, pre-approval rejection, replay rejection, expiry/cancellation, bounded requests/responses, TV remote focus, late async creation, account-check failure and Android cancellation before saving. These are development checks, not a third-party security audit or physical-device certification.

Lanternfin is an independent GPL-3.0-or-later fork of Extreme InfiniTV by Ludovico Ferrara / infinitel8p and contributors. See the repository LICENSE and attribution. QR generation uses qrcode-generator by Kazuhiko Arase under the MIT license; its notice ships in the app packages.

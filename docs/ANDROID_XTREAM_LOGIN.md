# Android TV rejects an account that works on a phone

The original Extreme InfiniTV source archived with this project and the inherited Lanternfin login code have two relevant differences between the phone and TV forms:

- The shared account check requested `player_api.php?username=…&password=…&action=get_account_info`. The usual account request omits `action`. Compatible servers can reject the extra action or return an empty array even though account authentication and catalogue requests work. The [XUI implementation's API documentation](https://xui.live/docs/api/xtream/#authentication-and-account-info) describes the action-less request; Lanternfin's LG/Samsung account check already uses it.
- The TV form stops when that check returns `unavailable`. The phone form runs the check but saves the account even when it fails, letting subsequent catalogue requests succeed. Identical credentials and network settings can therefore work on the phone while the TV displays “The server replied, but the response didn't look like an Xtream API.”

This is a reproduced compatibility bug and a likely explanation for the reported problem. We have not inspected the user's provider response or reproduced the failure on their Android TV, so it is not a confirmed diagnosis of that particular server. An HTML proxy/login page or other unexpected response can produce the same message.

## Fix in Lanternfin

- Login and diagnostics now request account information without an action parameter. Invalid credentials, HTTP errors, and non-account replies still fail validation.
- The TV Server URL field accepts a complete provider link, extracting the server and filling empty credential fields when editing finishes or the user submits. Already-entered credentials are preserved.
- TV pasted links now follow the phone's HTTPS default. An explicit `http://` provider address remains supported; TLS failures do not trigger an HTTP retry.

This patch changes the Lanternfin fork. It does not update an installed Extreme InfiniTV APK. The two apps use different application IDs.

## Verification

`tests/xtream-login.test.ts` exercises the actual TV form and credential persistence against a simulated compatible provider that accepts the action-less request and returns `[]` for unknown actions. Before the fix, valid credentials failed the account check and could not be saved on TV. After the fix, the form saves the account and opens the TV home screen.

Coverage also includes encoded credentials, pasted provider links, explicit HTTP, HTTPS defaults, rejected credentials, HTML/invalid JSON shapes, HTTP error statuses, expired/inactive accounts, and the diagnostics endpoint. The full suite passed 3,735 tests in 281 files, and the standalone Android TV web build succeeded. A physical Android TV login with the affected account remains to be checked.

# Lanternfin Home setup

Lanternfin Home runs the existing Lanternfin interface on a computer in your home. Paired browsers and updated Android, LG and Samsung apps share saved Xtream accounts, online M3U sources, and Xtream movie and episode progress. The computer must stay awake while you use the web app or sync. Installed apps retain their local accounts and playback when the computer is off.

## Start and stop

Install Node.js 24 and pnpm, then run `pnpm install` in the repository once. On Windows, double-click `start.bat`. On macOS or Linux, run `./start.sh` (or `sh start.sh`). The first start builds the web app. The launcher starts a background process and shows its address and an eight-digit pairing code.

Open **http://lanternfin.local/** on a device on the same home network. Enter the code once; the browser stays signed in. Run the start script again to show a fresh ten-minute code. Existing device pairings are retained. A new home initially has no provider accounts: add one through the regular app interface, or connect an updated installed app that already has your account.

Use `stop.bat` or `./stop.sh` to stop the service. These scripts contact this server's private local control endpoint; they do not terminate unrelated Node processes. The database and paired devices survive a stop or restart.

After updating the checkout, stop the server and run `start.bat --rebuild` or `./start.sh --rebuild` to rebuild the web interface. `pnpm home:status` shows the current address without issuing a new pairing code. `--no-open` suppresses the browser launch.

## Connect installed apps

Install a build containing Lanternfin Home, then open **Settings → Lanternfin Home** (or **Manage home connection** in the phone interface). Enter the computer address and the code from the launcher. Connecting shares that app's saved online sources and imports the household's sources. Your provider credentials do not need to be typed again on each screen.

Every connected device keeps its selected source and interface preferences. Progress sync runs approximately every five seconds while the app is active. Android queues native-player events while its library WebView is detached; those events can reach home sync when the library resumes. Movie and episode IDs are matched within the same Xtream server and username. Different providers or accounts are separate libraries, even if a movie has the same name.

Use **Sync now** to check the connection. **Disconnect this device** retains its local library and stops sharing. **Forget** revokes a paired device's future server access; it cannot erase accounts already downloaded onto that device. Pair again to reconnect it.

Offline changes are queued on the device. The server merges records per title. If another device changed the same title after the offline device last synced, the newer shared record is kept and the status reports the conflict. Deliberate removal of a resume point is synchronized as a deletion. This release shares one household history; it does not provide separate viewer profiles. Favorites, watchlists, downloaded media, local playlist files and device-specific settings are not synchronized. M3U sources are shared, but M3U progress is not mapped across the different app catalogs.

## Network address

The server advertises `lanternfin.local` with multicast DNS, including name-conflict detection. If another device owns that name, the launcher prints the alternative name it acquired. No hosts-file edits or router changes are made. The launcher selects the computer's home-network interface instead of common virtual-machine interfaces.

Multicast discovery must reach the other device. Guest Wi-Fi isolation, VPN routing and some TV/browser resolvers can prevent it. Use the **IP fallback** printed by the launcher in that case. If Windows prompts, allow Node.js on the private home network. Port 80 provides the address without a port suffix. If it is busy or requires privileges, the server uses port 47820 and the launcher prints `http://lanternfin.local:47820/`. It does not elevate itself or replace an existing web server.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `LANTERNFIN_HOME_PORT` | Use a specific available port. |
| `LANTERNFIN_HOME_ADDRESS` | Advertise a specific local IPv4 address when the computer has multiple networks. |
| `LANTERNFIN_HOME_DATA` | Store the database, runtime state and server log in a chosen directory. |

## Storage and playback

The default data directory is `~/.lanternfin/home` (`C:\Users\<user>\.lanternfin\home` on Windows). Stop the server before backing up the directory. It contains provider credentials and should remain private. Paired devices also retain credentials for standalone playback. The local HTTP connection is intended for a trusted home network; it is not an Internet-facing service. Pairing restricts access but does not encrypt LAN traffic. Do not forward its port through your router.

Browser provider requests and supported media pass through an authenticated local relay, allowing provider APIs without CORS and supporting byte-range seeking, HLS playlists, DASH manifests, and configured User-Agent headers. Redirect destinations are checked before connecting. Authorization headers are kept on their provider origin. The relay does not transcode video or bypass DRM. Browser codec support still applies; browser DRM needs a [secure context and supported key system](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMediaKeySystemAccess). Plain HTTP over the LAN is not a secure context. Android's native player retains its existing playback capabilities.

## Development checks

Run `pnpm home:test`, `pnpm test`, `pnpm home:build`, `pnpm tv:check`, and `pnpm tv:build`. The server tests cover pairing, revocation, persistence, stale writes, deletion, request guards and manifest rewriting. The shared-client tests cover Android/browser ID mapping, queued changes and LG/Samsung resume interoperability.

`node home-server/browser-smoke.mjs` exercises two isolated browser sessions against a temporary household and a local fixture provider. It defaults to installed Microsoft Edge; set `LANTERNFIN_TEST_BROWSER` to another installed Playwright browser channel if needed. Set `LANTERNFIN_TEST_MEDIA` to a local MP4 test fixture to include byte-range playback checks. The temporary account data is removed when the test finishes; screenshots are written under the ignored `artifacts/home-smoke` directory.

Lanternfin remains an independent GPL-3.0-or-later fork of Extreme InfiniTV by Ludovico Ferrara / infinitel8p and contributors. Existing attribution and licenses are retained. The server also uses the MIT-licensed Homebridge Ciao and xmldom packages; their license files are included in the installed dependencies.

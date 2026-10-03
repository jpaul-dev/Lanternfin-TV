# Android / LG / Samsung parity ledger

This is the implementation checklist for the standalone TV ports. Reference: the original `src/scripts/tv/` views, UI components and Android TV screenshots. “Implemented” means present in the portable app with local validation; it does not imply certified physical-TV behavior.

| Area | Portable implementation | Remaining software work |
| --- | --- | --- |
| Shell / Home | Compact icon rail, dark canvas, pink focus, artwork hero, live/movie/series/favorite/recent rails, continue-watching progress and card actions | Closer empty/loading states |
| Live TV | Category column, channel list, now/next programme panel, favorites, channel up/down, number tuning, playback programme OSD, programme details and archive replay | Broader archive-provider/device validation |
| Movies / Series | Artwork grids, details, credits, season/episode browsing, resume, last-season restoration, next episode after cold resume and optional countdown, natural title sorting, provider title-language filtering, remote page continuation and page jumps | Detail enrichment where provider data is absent |
| Search | Cancellable M3U search and whole-provider Xtream index, explicit partial status, opt-in bounded catalog cache, content-kind/language/watched filters and page jumps | Device-scale performance and navigation validation |
| Sources | M3U, Xtream and direct URL, explicit Remember, cancel/refresh/forget, up to 20 named sources, source switching, per-source XMLTV override and account status and encrypted backup/restore | Physical-TV transfer controls and provider validation |
| Library | Favorites, last 100 watched, VOD progress, saved Xtream references, continue-watching rail, card menus individual history removal and 10,000 independent watched marks, watched-only browsing and individual unmarking | Bulk library management |
| Guide | Xtream fallbacks and original streaming XMLTV worker; bounded cache, refresh, guide dates, manual feed override and bounded gzip fallback | Broader provider guide validation |
| Playback | Shaka HLS/DASH and bounded DRM license wrappers, MPEG-TS/FLV transmuxing, Samsung native path, safe HTML fallback, seek, retry, track menu, now/next OSD, episode continuation, seek bar, quality, picture size and supported VOD speeds | Further OSD parity and device/provider validation |
| Settings | Theme, accent, size, margins, reduced motion, guide clock, language preferences, optional automatic next episode, local diagnostics with reviewed export | Localization and other applicable Android options |
| Downloads / offline | Not implemented | Investigate platform storage, codec/DRM persistence and developer/store permissions before selecting a supported design |
| Casting / receiver | Deliberately absent from the standalone install | Optional future feature only; not required to watch |
| Updates / distribution | Reproducible source builds, LG IPK, unsigned Samsung WGT, setup companion | Store/signing workflow, update design, final name/trademark and dependency review |
| TV lifecycle | Samsung saver follows foreground playback; LG Type 2 configuration; standby saves progress and stops video; interrupted background indexing resumes while manual pauses persist; transient backup fields clear | Actual device standby, OLED dimming and saver validation |

## External validation gates

- No physical LG or Samsung TV is paired. Native decoding, DRM/CDM, provider CORS/TLS, standby, screen saver, TV keyboards and vendor remotes require a device acceptance log.
- Samsung packaging still needs the TV SDK, the owner's certificate profile and target DUID. The unsigned archive is not installable as-is.
- LG Simulator explicitly lacks DRM and mediaOption support; it demonstrates UI and supported unprotected media, not protected playback.
- Provider-controlled license access, allowed request headers, codec support and catch-up retention cannot be created by the UI framework. Never drop security/header requirements to force playback.

These gates are not reasons to stop the software work listed above. Checkpoints will update this ledger as features are built and tested.

## Screen saver and background work

Samsung's documented [AppCommon API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/appcommon-api.html) is called with OFF only during foreground playback (including bounded buffering after playback starts). Pause, stop, errors and leaving the app request ON. Delayed OFF callbacks are corrected after a pause or background transition. Missing/failed APIs do not crash playback; the TV's own Auto Protection Time setting still applies. LG's [Type 2 configuration](https://webostv.developer.lge.com/develop/guides/screensaver) covers the player's on-screen controls on supported OLED models; no private power service is used.

Visibility and page lifecycle events stop media, save existing progress, cancel foreground source/detail/guide/account/replay requests and pause provider indexing. Returning resumes an index only if it was running before suspension, without automatically restarting a stream. Transient backup contents and passphrases clear on background. Guide day choices refresh after returning. These behaviors have unit/UI integration coverage, not physical-TV standby certification.

# Android / LG / Samsung parity ledger

This is the implementation checklist for the standalone TV ports. Reference: the original `src/scripts/tv/` views, UI components and Android TV screenshots. “Implemented” means present in the portable app with local validation; it does not imply certified physical-TV behavior.

| Area | Portable implementation | Remaining software work |
| --- | --- | --- |
| Shell / Home | Compact icon rail, dark canvas, pink focus, artwork hero, live/movie/series/favorite/recent rails, continue-watching progress and card actions | Closer empty/loading states |
| Live TV | Category column, channel list, now/next programme panel, favorites, channel up/down, number tuning, playback programme OSD, programme details and archive replay | Broader archive-provider/device validation |
| Movies / Series | Artwork grids, details, credits, season/episode browsing, resume, last-season restoration, next episode after cold resume and optional countdown, natural title sorting | Detail enrichment where provider data is absent |
| Search | Cancellable M3U search and whole-provider Xtream index, explicit partial status, opt-in bounded catalog cache, content-kind and watched filters | Improved large-library browsing |
| Sources | M3U, Xtream and direct URL, explicit Remember, cancel/refresh/forget, up to 20 named sources, source switching, per-source XMLTV override and account status | Backup/restore workflow |
| Library | Favorites, last 100 watched, VOD progress, saved Xtream references, continue-watching rail, card menus individual history removal and 10,000 independent watched marks | Watched-list management |
| Guide | Xtream fallbacks and original streaming XMLTV worker; bounded cache, refresh, guide dates, manual feed override and bounded gzip fallback | Broader provider guide validation |
| Playback | Shaka HLS/DASH and bounded DRM license wrappers, MPEG-TS/FLV transmuxing, Samsung native path, safe HTML fallback, seek, retry, track menu, now/next OSD, episode continuation, seek bar, quality, picture size and supported VOD speeds | Further OSD parity and device/provider validation |
| Settings | Theme, accent, size, margins, reduced motion, guide clock, language preferences, optional automatic next episode | Localization, other applicable Android options and diagnostics |
| Downloads / offline | Not implemented | Investigate platform storage, codec/DRM persistence and developer/store permissions before selecting a supported design |
| Casting / receiver | Deliberately absent from the standalone install | Optional future feature only; not required to watch |
| Updates / distribution | Reproducible source builds, LG IPK, unsigned Samsung WGT, setup companion | Store/signing workflow, update design, final name/trademark and dependency review |

## External validation gates

- No physical LG or Samsung TV is paired. Native decoding, DRM/CDM, provider CORS/TLS, standby, screen saver, TV keyboards and vendor remotes require a device acceptance log.
- Samsung packaging still needs the TV SDK, the owner's certificate profile and target DUID. The unsigned archive is not installable as-is.
- LG Simulator explicitly lacks DRM and mediaOption support; it demonstrates UI and supported unprotected media, not protected playback.
- Provider-controlled license access, allowed request headers, codec support and catch-up retention cannot be created by the UI framework. Never drop security/header requirements to force playback.

These gates are not reasons to stop the software work listed above. Checkpoints will update this ledger as features are built and tested.

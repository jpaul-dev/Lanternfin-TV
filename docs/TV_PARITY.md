# Android / LG / Samsung parity ledger

This is the implementation checklist for the standalone TV ports. Reference: the original `src/scripts/tv/` views, UI components and Android TV screenshots. “Implemented” means present in the portable app with local validation; it does not imply certified physical-TV behavior.

| Area | Portable implementation | Remaining software work |
| --- | --- | --- |
| Shell / Home | Compact icon rail, dark canvas, pink focus, artwork hero, live/movie/series/favorite/recent rails | Continue-watching progress, card actions, closer empty/loading states |
| Live TV | Category column, channel list, now/next programme panel, favorites | Channel up/down and numeric tuning, playback programme OSD, catch-up, richer guide navigation |
| Movies / Series | Artwork grids, details, credits, season/episode browsing, resume | Sort/filter options, last-season restoration, next episode, detail enrichment where provider data is absent |
| Search | Cancellable M3U search and whole-provider Xtream index, explicit partial status | Persistent index, content-kind filters, improved large-library browsing |
| Sources | M3U, Xtream and direct URL, explicit Remember, cancel/refresh/forget | Multiple named sources, guide override, source switching, richer account status |
| Library | Favorites, last 100 watched, VOD progress, saved Xtream references | Card menus, continue-watching rail, hiding/removing individual entries |
| Guide | Xtream fallbacks and original streaming XMLTV worker; bounded cache, refresh | Gzip fallback on older engines, manual feed override, day navigation / catch-up |
| Playback | Shaka HLS/DASH and DRM configuration, Samsung native path, safe HTML fallback, seek, retry, track menu | OSD parity, next episode, supported quality/aspect controls, improved live tuning |
| Settings | Theme, accent, size, margins, reduced motion, guide clock, language preferences | Localization, other applicable Android options and diagnostics |
| Downloads / offline | Not implemented | Investigate platform storage, codec/DRM persistence and developer/store permissions before selecting a supported design |
| Casting / receiver | Deliberately absent from the standalone install | Optional future feature only; not required to watch |
| Updates / distribution | Reproducible source builds, LG IPK, unsigned Samsung WGT, setup companion | Store/signing workflow, update design, final name/trademark and dependency review |

## External validation gates

- No physical LG or Samsung TV is paired. Native decoding, DRM/CDM, provider CORS/TLS, standby, screen saver, TV keyboards and vendor remotes require a device acceptance log.
- Samsung packaging still needs the TV SDK, the owner's certificate profile and target DUID. The unsigned archive is not installable as-is.
- LG Simulator explicitly lacks DRM and mediaOption support; it demonstrates UI and supported unprotected media, not protected playback.
- Provider-controlled license access, allowed request headers, codec support and catch-up retention cannot be created by the UI framework. Never drop security/header requirements to force playback.

These gates are not reasons to stop the software work listed above. Checkpoints will update this ledger as features are built and tested.

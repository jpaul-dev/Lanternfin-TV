import { attachDialogSpatialNav } from "@/scripts/lib/dialog-spatial-nav"
import { getTmdbApiKey, isTmdbActive } from "@/scripts/lib/app-settings.js"
import { tmdbSearchTv } from "@/scripts/lib/tmdb"
import { t, getActiveLocale } from "@/scripts/lib/i18n"
import { openMetadataSettings } from "@/scripts/tv/ui/metadata-settings"

const STORAGE = "lanternfin_series_matches"
function saved(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || "{}")
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
export function seriesMatch(playlist: string, series: number): number | null {
  const id = saved()[JSON.stringify([playlist, series])]
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function chooseSeriesMatch(playlist: string, series: number, name: string, onChange: () => void): void {
  const previous = document.activeElement as HTMLElement | null
  const dialog = document.createElement("dialog")
  dialog.id = "lanternfin-series-match"
  dialog.className = "fixed inset-0 m-auto w-[36rem] max-h-[80vh] overflow-auto rounded-2xl border border-line bg-surface p-6 text-fg backdrop:bg-black/70"
  const heading = document.createElement("h2")
  heading.textContent = t("tv.episodes.match")
  heading.className = "mb-3 text-xl font-semibold"
  const status = document.createElement("p")
  status.className = "my-3 text-sm text-fg-2"
  status.setAttribute("role", "status")
  const input = document.createElement("input")
  input.value = name
  input.setAttribute("aria-label", t("tv.episodes.search"))
  input.className = "w-full rounded-xl border border-line bg-surface-2 p-3"
  const results = document.createElement("div")
  results.className = "my-3 flex flex-col gap-2"
  function button(label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement("button")
    b.type = "button"; b.textContent = label
    b.className = "rounded-xl bg-surface-2 px-4 py-3 text-left tv-focus-inset"
    b.addEventListener("click", action)
    return b
  }
  function apply(id: number | null): void {
    const entries = saved()
    const key = JSON.stringify([playlist, series])
    if (id == null) delete entries[key]; else entries[key] = id
    try { localStorage.setItem(STORAGE, JSON.stringify(entries)) } catch { status.textContent = t("tv.episodes.saveFailed"); return }
    dialog.close(); onChange()
  }
  let request = 0
  async function search(): Promise<void> {
    if (!isTmdbActive()) { status.textContent = t("tv.episodes.keyRequired"); return }
    const query = input.value.trim().slice(0, 200)
    if (!query) return
    const id = ++request
    status.textContent = t("tv.episodes.searching")
    results.replaceChildren()
    try {
      const matches = await tmdbSearchTv(getTmdbApiKey(), query, { language: getActiveLocale() })
      if (!dialog.open || id !== request) return
      for (const match of matches.slice(0, 12)) {
        if (!Number.isSafeInteger(match.id) || match.id <= 0) continue
        results.append(button(`${match.name || match.original_name || ""} ${match.first_air_date?.slice(0, 4) || ""}`, () => apply(match.id)))
      }
      status.textContent = matches.length ? t("tv.episodes.choose") : t("tv.episodes.noMatches")
      results.querySelector("button")?.focus()
    } catch { if (dialog.open && id === request) status.textContent = t("tv.episodes.lookupFailed") }
  }
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void search() } })
  dialog.append(heading, input, button(t("tv.episodes.search"), () => void search()), status, results,
    button(t("settings.tmdb.title"), () => { dialog.close(); openMetadataSettings(onChange) }),
    button(t("tv.episodes.resetMatch"), () => apply(null)), button(t("common.cancel"), () => dialog.close()))
  document.body.append(dialog)
  const cleanup = attachDialogSpatialNav(dialog)
  dialog.addEventListener("close", () => { request++; cleanup?.(); dialog.remove(); if (previous?.isConnected) previous.focus() }, { once: true })
  dialog.showModal()
  input.focus()
  if (!isTmdbActive()) status.textContent = t("tv.episodes.keyRequired")
}

import { getTmdbApiKey, setTmdbApiKey, setTmdbEnabled } from "@/scripts/lib/app-settings.js"
import { validateTmdbKey } from "@/scripts/lib/tmdb"
import { attachDialogSpatialNav } from "@/scripts/lib/dialog-spatial-nav"
import { openExternal } from "@/scripts/lib/external-link"
import { t } from "@/scripts/lib/i18n"

export function openMetadataSettings(onChange: () => void): void {
  const previous = document.activeElement as HTMLElement | null
  const dialog = document.createElement("dialog")
  dialog.id = "lanternfin-metadata-settings"
  dialog.setAttribute("aria-labelledby", "lanternfin-metadata-heading")
  dialog.className = "fixed inset-0 m-auto w-[36rem] max-h-[80vh] overflow-auto rounded-2xl border border-line bg-surface p-6 text-fg backdrop:bg-black/70"
  const heading = document.createElement("h2")
  heading.id = "lanternfin-metadata-heading"
  heading.className = "mb-3 text-xl font-semibold"
  heading.textContent = t("settings.tmdb.title")
  const privacy = document.createElement("p")
  privacy.className = "mb-4 text-sm text-fg-2"
  privacy.textContent = t("settings.tmdb.privacy")
  const label = document.createElement("label")
  label.htmlFor = "lanternfin-tmdb-key"
  label.textContent = t("settings.tmdb.apiKey")
  const input = document.createElement("input")
  input.id = label.htmlFor
  input.type = "password"
  input.autocomplete = "off"
  input.spellcheck = false
  input.maxLength = 8192
  input.value = getTmdbApiKey()
  input.className = "my-2 w-full rounded-xl border border-line bg-surface-2 p-3"
  const help = document.createElement("p")
  help.className = "mb-3 text-sm text-fg-2"
  help.textContent = t("settings.tmdb.apiKeyHelper")
  const status = document.createElement("p")
  status.className = "my-3 text-sm text-fg-2"
  status.setAttribute("role", "status")
  const actions = document.createElement("div")
  actions.className = "flex flex-col gap-2"
  function button(label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = label
    b.className = "rounded-xl bg-surface-2 px-4 py-3 text-left tv-focus-inset disabled:opacity-40"
    b.addEventListener("click", action)
    return b
  }
  let request = 0
  const save = button(t("tv.episodes.enableMetadata"), () => void enable())
  async function enable(): Promise<void> {
    const key = input.value.trim()
    if (!key || save.disabled) return
    const id = ++request
    save.disabled = true
    input.disabled = true
    status.textContent = t("settings.tmdb.test") + "…"
    const result = await validateTmdbKey(key)
    if (!dialog.open || id !== request) return
    save.disabled = false
    input.disabled = false
    if (!result.ok) {
      status.textContent = t(result.status === 401 || result.status === 403 ? "settings.tmdb.testFail" : "settings.tmdb.testNetwork")
      input.focus()
      return
    }
    setTmdbApiKey(key)
    setTmdbEnabled(true)
    dialog.close()
    onChange()
  }
  const reveal = button(t("settings.tmdb.reveal"), () => {
    input.type = input.type === "password" ? "text" : "password"
    reveal.textContent = t(input.type === "password" ? "settings.tmdb.reveal" : "settings.tmdb.conceal")
  })
  actions.append(save, reveal,
    button(t("settings.tmdb.getKey"), () => void openExternal("https://www.themoviedb.org/settings/api")),
    button(t("tv.episodes.disableMetadata"), () => { request++; setTmdbEnabled(false); dialog.close(); onChange() }),
    button(t("common.cancel"), () => dialog.close()))
  dialog.append(heading, privacy, label, input, help, status, actions)
  document.body.append(dialog)
  const cleanup = attachDialogSpatialNav(dialog)
  dialog.addEventListener("close", () => {
    request++
    input.value = ""
    cleanup?.()
    dialog.remove()
    if (previous?.isConnected) previous.focus()
  }, { once: true })
  dialog.showModal()
  input.focus()
}

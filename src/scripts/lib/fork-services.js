// Optional, independently operated metadata service. No upstream relay is used.
export function getTvdbProxyUrl() {
  const value = String(import.meta.env.PUBLIC_TVDB_PROXY_URL || "").trim()
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href.replace(/\/+$/, "")
      : ""
  } catch {
    return ""
  }
}

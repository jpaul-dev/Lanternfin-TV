/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const providerFetch = vi.fn()
vi.mock("@/scripts/lib/provider-fetch.js", () => ({ providerFetch }))

beforeEach(() => {
  vi.resetModules()
  providerFetch.mockReset().mockRejectedValue(new TypeError("TLS connection failed"))
  const stored = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  })
  vi.stubEnv("PUBLIC_TVDB_PROXY_URL", "")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("credential transport", () => {
  it("keeps a saved playlist out of cookies and expires the old cookie", async () => {
    document.cookie = `xt_playlists=${encodeURIComponent(JSON.stringify({ entries: [], selectedId: "" }))}; path=/`
    expect(document.cookie).toContain("xt_playlists=")
    const { addEntry } = await import("@/scripts/lib/creds.js")
    await addEntry({ type: "xtream", serverUrl: "https://provider.example", username: "test", password: "test-secret" })
    expect(localStorage.getItem("xt_playlists")).toContain("test-secret")
    expect(document.cookie).not.toContain("xt_playlists=")
  })
  it.each(["https://provider.example", "provider.example", "provider.example:8080"])(
    "does not retry %s with plaintext credentials after a TLS failure", async (serverUrl) => {
      const { resolveServerScheme } = await import("@/scripts/lib/creds.js")
      const result = await resolveServerScheme({ serverUrl, username: "test", password: "test" })
      expect(result.scheme).toBe("https")
      expect(result.test.status).toBe("unavailable")
      expect(providerFetch).toHaveBeenCalledTimes(1)
      expect(providerFetch.mock.calls[0][0]).toMatch(/^https:\/\//)
    }
  )
  it("allows an explicitly supplied HTTP provider", async () => {
    const { resolveServerScheme } = await import("@/scripts/lib/creds.js")
    const result = await resolveServerScheme({ serverUrl: "http://provider.example", username: "test", password: "test" })
    expect(result.scheme).toBe("http")
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(providerFetch.mock.calls[0][0]).toMatch(/^http:\/\//)
  })
  it.each(["https://provider.example/list.m3u?token=test", "provider.example/list.m3u?token=test"])(
    "does not downgrade playlist URL %s", async (url) => {
      const { resolveM3UScheme } = await import("@/scripts/lib/creds.js")
      const result = await resolveM3UScheme(url)
      expect(result.scheme).toBe("https")
      expect(providerFetch).toHaveBeenCalledTimes(1)
      expect(providerFetch.mock.calls[0][0]).toMatch(/^https:\/\//)
    }
  )
  it("defaults a pasted scheme-less Xtream URL to HTTPS", async () => {
    const { parseXtreamUrl } = await import("@/scripts/lib/creds.js")
    expect(parseXtreamUrl("provider.example/get.php?username=test&password=test")?.serverUrl).toBe("https://provider.example")
  })
})

describe("optional metadata service", () => {
  it("makes no network request even when enabled without a configured service", async () => {
    localStorage.setItem("xt_tvdb_enabled", "1")
    const { getTvdbEnabled } = await import("@/scripts/lib/app-settings.js")
    const { fetchTvdbTitle } = await import("@/scripts/lib/tvdb-proxy")
    expect(getTvdbEnabled()).toBe(false)
    await fetchTvdbTitle("movie", 123)
    expect(providerFetch).not.toHaveBeenCalled()
  })
  it("requires an explicit opt-in even with a configured service", async () => {
    vi.stubEnv("PUBLIC_TVDB_PROXY_URL", "https://metadata.example.test")
    const { getTvdbEnabled, setTvdbEnabled } = await import("@/scripts/lib/app-settings.js")
    expect(getTvdbEnabled()).toBe(false)
    setTvdbEnabled(true)
    expect(getTvdbEnabled()).toBe(true)
  })
  it("rejects a plaintext metadata service", async () => {
    vi.stubEnv("PUBLIC_TVDB_PROXY_URL", "http://metadata.example.test")
    const { getTvdbProxyUrl } = await import("@/scripts/lib/fork-services.js")
    expect(getTvdbProxyUrl()).toBe("")
  })
})

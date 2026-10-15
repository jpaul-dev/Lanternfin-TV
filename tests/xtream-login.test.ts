/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { providerFetch, navigate } = vi.hoisted(() => ({ providerFetch: vi.fn(), navigate: vi.fn() }))
vi.mock("@/scripts/lib/provider-fetch.js", () => ({ providerFetch }))
vi.mock("astro:transitions/client", () => ({ navigate }))
vi.mock("@/scripts/lib/i18n", () => ({ t: (key: string) => key, applyI18nDOM: vi.fn(), LOCALE_EVENT: "test:locale" }))
vi.mock("@/scripts/lib/toast", () => ({ toastSuccess: vi.fn(), toastWarn: vi.fn() }))

import { getEntries, restoreState, testXtreamConnection } from "@/scripts/lib/creds.js"
import view from "@/scripts/tv/views/login"
import { runXtreamDiagnostic } from "@/scripts/lib/diagnostic"

const credentials = { serverUrl: "https://provider.example:8443", username: "alice+test", password: "p&a=ss?" }
const account = { user_info: { auth: 1, status: "Active", exp_date: null, allowed_output_formats: ["TS", "m3u8"] } }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })
let unmount: (() => void) | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  providerFetch.mockReset()
  const stored = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  })
  await restoreState({ entries: [], selectedId: "" })
  document.body.innerHTML = '<main id="login"></main>'
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  vi.unstubAllGlobals()
})

// Some compatible servers return [] for unknown actions, even with valid
// credentials. Their action-less account endpoint and catalogue still work.
function compatibleProvider() {
  providerFetch.mockImplementation(async (input: string) => {
    const url = new URL(input)
    if (url.pathname !== "/player_api.php" || url.searchParams.has("action")) return json([])
    if (url.searchParams.get("username") !== credentials.username || url.searchParams.get("password") !== credentials.password) {
      return json({ user_info: { auth: 0 } })
    }
    return json(account)
  })
}

function field(role: string) { return document.querySelector<HTMLInputElement>(`[data-role="${role}"]`)! }
function mount() { unmount = view.mount(document.getElementById("login")!, { view: "login", url: new URL("https://app.example/tv/login") }) }
async function submit() {
  document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(field("connect").disabled).toBe(false))
}

describe("Xtream account check", () => {
  it("authenticates a compatible server without an unsupported account action", async () => {
    compatibleProvider()
    expect(await testXtreamConnection(credentials)).toMatchObject({ status: "active", expDate: null, allowedOutputFormats: ["ts", "m3u8"] })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    const url = new URL(providerFetch.mock.calls[0][0])
    expect(url.origin).toBe(credentials.serverUrl)
    expect([...url.searchParams.keys()].sort()).toEqual(["password", "username"])
  })

  it.each([0, "0"])("keeps rejecting auth=%s even if the status says Active", async (auth) => {
    providerFetch.mockResolvedValue(json({ user_info: { auth, status: "Active" } }))
    expect(await testXtreamConnection(credentials)).toMatchObject({ status: "unavailable", reason: "auth_rejected" })
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it.each([[], {}, null, { user_info: { auth: 1 } }])("rejects an unexpected JSON reply: %j", async (reply) => {
    providerFetch.mockResolvedValue(json(reply))
    expect(await testXtreamConnection(credentials)).toMatchObject({ status: "unavailable", reason: "bad_response" })
  })

  it("rejects an HTML login or proxy page", async () => {
    providerFetch.mockResolvedValue(new Response("<!doctype html><title>Sign in</title>"))
    expect(await testXtreamConnection(credentials)).toMatchObject({ status: "unavailable", reason: "bad_response" })
  })

  it.each([[401, "auth_rejected"], [403, "auth_rejected"], [404, "not_found"], [429, "rate_limited"], [503, "server_error"]])("preserves HTTP %s errors", async (status, reason) => {
    providerFetch.mockResolvedValue(new Response("", { status: Number(status) }))
    expect(await testXtreamConnection(credentials)).toMatchObject({ status: "unavailable", reason, httpStatus: status })
    expect(providerFetch).toHaveBeenCalledTimes(1)
  })

  it.each([["Active", "1", "expired"], ["Disabled", null, "inactive"]])("preserves %s account state", async (status, exp_date, expected) => {
    providerFetch.mockResolvedValue(json({ user_info: { auth: 1, status, exp_date } }))
    expect(await testXtreamConnection(credentials)).toMatchObject({ status: expected })
  })

  it("uses the same account endpoint in diagnostics and reports inactive accounts accurately", async () => {
    providerFetch.mockImplementation(async (input: string) => new URL(input).searchParams.has("action")
      ? json([]) : json({ user_info: { auth: 1, status: "Disabled" } }))
    const result = await runXtreamDiagnostic(credentials)
    expect(result.verdict).toBe("warn")
    expect(result.steps[0]).toMatchObject({ labelKey: "diagnostic.step.auth", status: "warn" })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(new URL(providerFetch.mock.calls[0][0]).searchParams.has("action")).toBe(false)
  })
})

describe("Android TV login", () => {
  it("saves and opens a valid account when unsupported actions return an empty array", async () => {
    compatibleProvider()
    mount()
    field("server-url").value = credentials.serverUrl
    field("username").value = credentials.username
    field("password").value = credentials.password
    await submit()
    expect(await getEntries()).toEqual([expect.objectContaining({ type: "xtream", ...credentials })])
    expect(navigate).toHaveBeenCalledWith("/tv", { history: "replace" })
  })

  it("accepts a complete provider link in Server URL, including submit without an input event", async () => {
    compatibleProvider()
    mount()
    field("server-url").value = `${credentials.serverUrl}/get.php?${new URLSearchParams({ username: credentials.username, password: credentials.password, type: "m3u_plus" })}`
    await submit()
    expect(await getEntries()).toEqual([expect.objectContaining(credentials)])
    expect(field("server-url").value).toBe(credentials.serverUrl)
    expect(navigate).toHaveBeenCalled()
  })

  it("normalizes a pasted server link without overwriting entered credentials", async () => {
    compatibleProvider()
    mount()
    field("username").value = credentials.username
    field("password").value = credentials.password
    field("server-url").value = `${credentials.serverUrl}/player_api.php?username=other&password=other`
    field("server-url").dispatchEvent(new Event("change", { bubbles: true }))
    expect(field("server-url").value).toBe(credentials.serverUrl)
    expect(field("username").value).toBe(credentials.username)
    expect(field("password").value).toBe(credentials.password)
    await submit()
    expect(navigate).toHaveBeenCalled()
  })

  it.each(["paste", "server-url"])("uses HTTPS by default and preserves explicit HTTP in %s", async (role) => {
    providerFetch.mockImplementation(async () => json(account))
    mount()
    field(role).value = "provider.example/get.php?username=alice&password=test"
    field(role).dispatchEvent(new Event(role === "paste" ? "input" : "change", { bubbles: true }))
    expect(field("server-url").value).toBe("https://provider.example")
    field(role).value = "http://provider.example/get.php?username=alice&password=test"
    field(role).dispatchEvent(new Event(role === "paste" ? "input" : "change", { bubbles: true }))
    await submit()
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(new URL(providerFetch.mock.calls[0][0]).protocol).toBe("http:")
    expect(await getEntries()).toEqual([expect.objectContaining({ serverUrl: "http://provider.example" })])
  })

  it.each([
    [{ user_info: { auth: 0 } }, "login.status.badCredentials"],
    [[], "login.status.badResponseXtream"],
  ])("does not save or navigate after invalid response %j", async (reply, message) => {
    providerFetch.mockImplementation(async () => json(reply))
    mount()
    field("server-url").value = credentials.serverUrl
    field("username").value = credentials.username
    field("password").value = credentials.password
    await submit()
    expect(await getEntries()).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
    expect(field("status").textContent).toBe(message)
  })
})

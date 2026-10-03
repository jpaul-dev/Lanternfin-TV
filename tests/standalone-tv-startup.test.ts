import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { CLASSIC_ROUTE_TABLE, TV_ROUTE_TABLE } from "../src/scripts/lib/tv-routes"

function inlineScripts(path: string): string[] {
  return Array.from(
    readFileSync(new URL(path, import.meta.url), "utf8").matchAll(/<script\b[^>]*is:inline[^>]*>([\s\S]*?)<\/script>/g),
    (match) => match[1],
  )
}

const defaultsScript = inlineScripts("../src/components/ReceiverDefaults.astro")[0]
const classicScripts = inlineScripts("../src/layouts/Layout.astro")
const classicBoot = classicScripts.find((script) => script.includes("var perfStored"))!
const classicRoute = classicScripts.find((script) => script.includes("var tvRedirectPath"))!
const tvBoot = inlineScripts("../src/layouts/TvLayout.astro")[0]

function startup(initial: Record<string, string> = {}, path = "/", isTv = true) {
  const values = new Map(Object.entries(initial))
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
  const replace = vi.fn()
  const context = {
    receiverBuild: false,
    appMode: "",
    tvRouteTable: TV_ROUTE_TABLE,
    classicRouteTable: CLASSIC_ROUTE_TABLE,
    localStorage,
    sessionStorage: { getItem: () => null },
    navigator: { userAgent: isTv ? "Android SmartTV" : "Desktop" },
    location: { pathname: path, search: "", replace },
    window: {
      AndroidDeviceInfo: { isTv: () => isTv },
      matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    },
    document: {
      documentElement: {
        dataset: {} as Record<string, string>,
        style: { setProperty: vi.fn() },
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      },
    },
    URLSearchParams,
  }
  const run = () => {
    runInNewContext(defaultsScript, context)
    if (path.startsWith("/tv")) runInNewContext(tvBoot, context)
    else {
      runInNewContext(classicBoot, context)
      runInNewContext(classicRoute, context)
    }
  }
  return { values, replace, context, run }
}

describe("standalone TV startup", () => {
  it("opens TV browsing on a fresh install without enabling the receiver", () => {
    const app = startup()
    app.run()
    expect(app.replace.mock.calls).toEqual([["/tv"]])
    expect(app.values.get("xt_receiver_mode")).toBe("0")
    expect(app.values.get("xt_receiver_boot")).toBe("0")
    expect(app.values.get("xt_perf_mode")).toBe("1")
  })

  it("still detects the TV when performance and receiver preferences already exist", () => {
    const app = startup({ xt_perf_mode: "0", xt_receiver_mode: "0", xt_receiver_boot: "0" })
    app.run()
    expect(app.replace).toHaveBeenCalledWith("/tv")
    expect(app.values.get("xt_perf_mode")).toBe("0")
  })

  it.each(["/", "/tv"])("migrates the old automatic receiver defaults at %s", (path) => {
    const app = startup({
      xt_is_tv: "1",
      xt_receiver_mode: "1", xt_receiver_mode_auto: "1",
      xt_receiver_boot: "1", xt_receiver_boot_auto: "1",
    }, path)
    app.run()
    expect(app.replace).not.toHaveBeenCalledWith("/receiver")
    expect(app.values.get("xt_receiver_mode")).toBe("0")
    expect(app.values.get("xt_receiver_boot")).toBe("0")
    expect(app.values.has("xt_receiver_mode_auto")).toBe(false)
    expect(app.values.has("xt_receiver_boot_auto")).toBe(false)
  })

  it.each(["/", "/tv"])("preserves an explicit receiver startup choice at %s", (path) => {
    const app = startup({ xt_receiver_mode: "1", xt_receiver_boot: "1" }, path)
    app.run()
    expect(app.replace).toHaveBeenCalledWith("/receiver")
    expect(app.values.get("xt_receiver_mode")).toBe("1")
  })

  it("allows receiving casts without forcing receiver startup", () => {
    const app = startup({ xt_receiver_mode: "1", xt_receiver_boot: "0" })
    app.run()
    expect(app.replace.mock.calls).toEqual([["/tv"]])
    expect(app.values.get("xt_receiver_mode")).toBe("1")
  })

  it("leaves desktop startup on the normal home page", () => {
    const app = startup({}, "/", false)
    app.run()
    expect(app.replace).not.toHaveBeenCalled()
  })

  it("does not migrate an explicitly requested kiosk build", () => {
    const app = startup({ xt_receiver_mode: "1", xt_receiver_mode_auto: "1" })
    app.context.receiverBuild = true
    runInNewContext(defaultsScript, app.context)
    expect(app.values.get("xt_receiver_mode")).toBe("1")
  })

  it("tolerates unavailable browser storage", () => {
    const app = startup()
    app.context.localStorage.getItem = () => { throw new Error("Storage denied") }
    expect(() => app.run()).not.toThrow()
  })
})

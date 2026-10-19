// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const html = readFileSync("src-tauri/src/companion.html", "utf8")
const script = readFileSync("src-tauri/src/companion.js", "utf8")
const request = vi.fn()
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let playback: Record<string, unknown>
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = html.match(/<body>([\s\S]*)<script/)![1]
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  Object.defineProperty(document, "hidden", { configurable: true, value: false })
  playback = { state: "playing", title: "A movie", positionSeconds: 100, durationSeconds: 7200, seekable: true }
  request.mockReset().mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => url === "/pair" ? { key: "test-paired-key", name: "Sony TV" } : url === "/state" ? playback : { ok: true } }))
  vi.stubGlobal("fetch", request)
  new Function(script)()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function pair() {
  el<HTMLInputElement>("code").value = "123456"
  el("pair-form").dispatchEvent(new Event("submit", { cancelable: true }))
  await flush()
}
describe("local browser companion", () => {
  it("pairs then sends an authenticated exact seek", async () => {
    await pair()
    expect(el("remote").hidden).toBe(false)
    expect(el("title").textContent).toBe("A movie")
    el<HTMLInputElement>("time").value = "1:23:45"
    el("time-form").dispatchEvent(new Event("submit", { cancelable: true }))
    await flush()
    const seek = request.mock.calls.find(([url]) => url === "/seek")!
    expect(JSON.parse(seek[1].body)).toEqual({ seconds: 5025 })
    expect(seek[1].headers["X-XT-Key"]).toBe("test-paired-key")
  })
  it("does not seek beyond the movie or seek a live stream", async () => {
    await pair()
    el<HTMLInputElement>("time").value = "9:00:00"
    el("time-form").dispatchEvent(new Event("submit", { cancelable: true }))
    expect(request.mock.calls.some(([url]) => url === "/seek")).toBe(false)
    playback = { ...playback, isLive: true, seekable: false }
    await vi.advanceTimersByTimeAsync(2000)
    expect(el<HTMLButtonElement>("forward").disabled).toBe(true)
    expect(el("timeline").hidden).toBe(true)
  })
  it("disconnects without sending a stop command or allowing an in-flight poll to reconnect", async () => {
    await pair()
    let resolve: (value: unknown) => void = () => {}
    request.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    await vi.advanceTimersByTimeAsync(2000)
    el<HTMLButtonElement>("disconnect").click()
    resolve({ ok: true, status: 200, json: async () => playback })
    await flush()
    expect(el("remote").hidden).toBe(true)
    expect(request.mock.calls.some(([url]) => url === "/stop")).toBe(false)
  })
  it("selects subtitles, switches audio, and turns subtitles off for the current video", async () => {
    playback = { ...playback, companion: true, playbackId: "movie-1", tracksRevision: 7, audioAutomatic: true,
      tracks: [{ id: "2:0", kind: "text", label: "English", selected: false },
        { id: "3:0", kind: "audio", label: "Spanish", selected: false }] }
    await pair()
    for (const [field, kind, id] of [["subtitle-track", "text", "2:0"], ["audio-track", "audio", "3:0"], ["subtitle-track", "text", ""]]) {
      el<HTMLSelectElement>(field).value = id
      el(field).dispatchEvent(new Event("change"))
      await flush()
      const call = request.mock.calls.filter(([url]) => url === "/track").at(-1)!
      expect(JSON.parse(call[1].body)).toEqual({ playbackId: "movie-1", tracksRevision: 7, kind, id: id || null })
      expect(call[1].headers["X-XT-Key"]).toBe("test-paired-key")
    }
    playback = { ...playback, state: "idle", tracks: [] }
    await vi.advanceTimersByTimeAsync(2000)
    expect(el<HTMLSelectElement>("subtitle-track").disabled).toBe(true)
    expect(el<HTMLSelectElement>("audio-track").disabled).toBe(true)
  })
  it("returns to pairing when the TV revokes authorization", async () => {
    await pair()
    request.mockResolvedValueOnce({ ok: false, status: 401 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(el("pair").hidden).toBe(false)
    expect(el("message").textContent).toContain("Pair again")
  })
})

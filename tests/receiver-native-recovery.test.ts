import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReceiverEngine, ReceiverStatePartial } from "../src/scripts/receiver/engines"

vi.mock("@/scripts/lib/player-runtime", () => ({ mountPlayer: async () => null, playWhenReady: () => {} }))
const probe = vi.fn()
vi.mock("@/scripts/lib/provider-fetch.js", () => ({ providerFetch: (...args: unknown[]) => probe(...args) }))
vi.mock("@/scripts/lib/i18n.js", () => ({ t: (key: string) => key }))
const listeners = new Map<string, Array<(event: unknown) => void>>()
const control = vi.fn(() => true)
const sessionEnd = vi.fn()
let createEngine: typeof import("../src/scripts/receiver/engines").createAndroidNativeReceiverEngine
beforeAll(async () => {
  vi.stubGlobal("document", { addEventListener(type: string, callback: (event: unknown) => void) {
    listeners.set(type, [...(listeners.get(type) ?? []), callback])
  } })
  vi.stubGlobal("navigator", { userAgent: "Android TV" })
  vi.stubGlobal("window", { AndroidVideo: {
    launchVod: () => true, receiverSessionStart: () => true,
    receiverControl: control, receiverSessionEnd: sessionEnd, drainEvents: () => "[]",
  } })
  createEngine = (await import("../src/scripts/receiver/engines")).createAndroidNativeReceiverEngine
})
function emit(type: string, payload: Record<string, unknown>) {
  for (const listener of listeners.get(type) ?? []) listener({ detail: { contentKey: "receiver-vod-1", ...payload } })
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe("native movie recovery", () => {
  let engine: ReceiverEngine
  let reports: ReceiverStatePartial[]
  let ended: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.clearAllMocks()
    reports = []; ended = vi.fn()
    engine = createEngine({ report: value => reports.push(value), onSessionEnded: ended })
    await engine.play({ v: 1, src: "https://fixture.invalid/movie.mp4", mime: "video/mp4", isLive: false, title: "Movie" })
  })
  afterEach(() => engine.teardown())

  it("keeps the movie open through several minute-spaced reconnects and preserves progress", async () => {
    for (let minute = 1; minute <= 4; minute++) {
      emit("xt:android-native-progress", { positionMs: minute * 60_000, durationMs: 7_200_000 })
      emit("xt:android-native-buffering", { positionMs: minute * 60_000, code: "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT", attempt: 1 })
      expect(reports.at(-1)).toMatchObject({ state: "buffering", positionSeconds: minute * 60, durationSeconds: 7200 })
      emit("xt:android-native-progress", { positionMs: minute * 60_000 + 2000, durationMs: 7_200_000 })
      expect(reports.at(-1)).toMatchObject({ state: "playing", positionSeconds: minute * 60 + 2 })
    }
    expect(control).not.toHaveBeenCalled()
    expect(sessionEnd).not.toHaveBeenCalled()
    expect(ended).not.toHaveBeenCalled()
  })

  it("keeps a failed player available for Retry without probing or erasing its position", async () => {
    emit("xt:android-native-progress", { positionMs: 65_000, durationMs: 7_200_000 })
    emit("xt:android-native-error", { code: "SOURCE_ENDED_EARLY", positionMs: 65_000, playerRetained: true })
    await settle()
    expect(reports.at(-1)).toMatchObject({ state: "error" })
    expect(reports.at(-1)?.positionSeconds).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
    expect(control).not.toHaveBeenCalled()
    expect(sessionEnd).not.toHaveBeenCalled()
    expect(ended).not.toHaveBeenCalled()
    emit("xt:android-native-buffering", { positionMs: 65_000 })
    emit("xt:android-native-progress", { positionMs: 67_000, durationMs: 7_200_000 })
    expect(reports.at(-1)).toMatchObject({ state: "playing", positionSeconds: 67 })
    emit("xt:android-native-error", { code: "ERROR_CODE_DECODING_FAILED", playerRetained: true })
    await settle()
    expect(reports.filter(value => value.state === "error")).toHaveLength(2)
  })

  it("still exits on explicit Back or real completion", async () => {
    emit("xt:android-native-finished", { completed: false })
    expect(ended).toHaveBeenCalledTimes(1)
    expect(control).toHaveBeenCalledWith("stop", 0)
  })

  it("retains compatibility with fatal errors from older Android builds", async () => {
    emit("xt:android-native-error", { code: "ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT" })
    await settle()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(control).toHaveBeenCalledWith("stop", 0)
  })
})

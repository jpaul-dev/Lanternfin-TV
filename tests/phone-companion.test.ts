// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest"
const { invoke, advertise, enable } = vi.hoisted(() => ({ invoke: vi.fn(), advertise: vi.fn(), enable: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@/scripts/lib/app-settings", () => ({ getEffectiveReceiverDeviceName: () => "Sony", getReceiverModeEnabled: () => false }))
vi.mock("@/scripts/lib/receiver-discovery", () => ({ advertiseReceiver: advertise, stopAdvertisingReceiver: vi.fn() }))
vi.mock("@/scripts/lib/dialog-spatial-nav", () => ({ attachDialogSpatialNav: () => () => {} }))
import { restorePhoneCompanion, openPhoneCompanion } from "@/scripts/lib/phone-companion"
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear()
  window.AndroidVideo = { companionSetEnabled: enable } as typeof window.AndroidVideo
  invoke.mockResolvedValue({ name: "Sony", port: 47815, id: "tv", pairCode: "123456", pairCodeExpiresInSeconds: 120, ips: [], pairedDevices: [] })
  advertise.mockResolvedValue(undefined)
  HTMLDialogElement.prototype.showModal = function() { this.open = true }
  HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new Event("close")) }
})
afterEach(() => { document.querySelector<HTMLDialogElement>("dialog")?.close(); document.body.innerHTML = ""; vi.clearAllTimers(); vi.useRealTimers() })
it("only restarts local control when the viewer previously enabled it", async () => {
  await restorePhoneCompanion(); expect(invoke).not.toHaveBeenCalled()
  localStorage.setItem("lf_phone_companion", "1")
  await restorePhoneCompanion()
  expect(invoke).toHaveBeenCalledWith("receiver_start", { name: "Sony" })
  expect(enable).toHaveBeenCalledWith(true)
  expect(advertise).toHaveBeenCalledWith("Sony", 47815, "tv")
})
it("opening settings repairs an enabled companion whose server was lost", async () => {
  localStorage.setItem("lf_phone_companion", "1")
  await openPhoneCompanion()
  expect(invoke).toHaveBeenCalledWith("receiver_start", { name: "Sony" })
  expect(document.querySelector("[data-status]")?.textContent).toContain("120s")
})
it("does not claim a failed server start succeeded or enable native commands", async () => {
  localStorage.setItem("lf_phone_companion", "1"); invoke.mockRejectedValueOnce(new Error("Unavailable"))
  await openPhoneCompanion()
  expect(enable).not.toHaveBeenCalled(); expect(advertise).not.toHaveBeenCalled()
  expect(document.querySelector("[data-status]")?.textContent).toContain("Could not connect")
})

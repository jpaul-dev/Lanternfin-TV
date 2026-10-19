import { invoke } from "@tauri-apps/api/core"
import qrcode from "qrcode-generator"
import { attachDialogSpatialNav } from "./dialog-spatial-nav"
import { getEffectiveReceiverDeviceName, getReceiverModeEnabled } from "./app-settings"
import { advertiseReceiver, stopAdvertisingReceiver } from "./receiver-discovery"
import { pairableReceiverIps, formatReceiverPairCode, type ReceiverStatus } from "./receiver-shared"

const KEY = "lf_phone_companion"
export function companionEnabled(): boolean { return localStorage.getItem(KEY) === "1" }
export function companionAvailable(): boolean { return typeof window.AndroidVideo?.companionSetEnabled === "function" }

export async function startPhoneCompanion(): Promise<ReceiverStatus> {
  const status = await invoke<ReceiverStatus>("receiver_start", { name: getEffectiveReceiverDeviceName() || undefined })
  window.AndroidVideo?.companionSetEnabled?.(true)
  if (status.port) await advertiseReceiver(status.name, status.port, status.id)
  localStorage.setItem(KEY, "1")
  return status
}

export async function restorePhoneCompanion(): Promise<void> {
  if (companionAvailable() && companionEnabled()) await startPhoneCompanion()
}

export async function openPhoneCompanion(): Promise<void> {
  if (document.getElementById("phone-companion")) return
  const dialog = document.createElement("dialog")
  dialog.id = "phone-companion"
  dialog.className = "m-auto w-[52rem] max-w-[92vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-surface p-8 text-fg backdrop:bg-black/75"
  dialog.setAttribute("aria-labelledby", "phone-companion-title")
  dialog.innerHTML = `
    <p class="text-sm uppercase tracking-widest text-accent">Lanternfin · Better together</p>
    <h2 id="phone-companion-title" class="mt-2 text-3xl font-semibold">Your phone. Your remote.</h2>
    <p class="mt-3 text-fg-3">Browse on your phone, watch here. Scrub to any moment or type an exact time.</p>
    <div class="mt-6 flex gap-8 items-center">
      <div data-qr class="hidden shrink-0 rounded-xl bg-white p-4"></div>
      <div class="min-w-0 flex-1">
        <p>On the same Wi-Fi, open <strong>Connect to TV</strong> in the Lanternfin phone app.</p>
        <p class="mt-3 text-fg-3">Or scan for a quick remote in your phone’s browser.</p>
        <p data-name class="mt-5 text-accent"></p>
        <p data-code class="my-2 text-5xl font-semibold tabular-nums tracking-widest">—</p>
        <p data-status role="status" class="text-sm text-fg-3">Choose Enable to allow paired phones to control this TV.</p>
        <p data-address class="mt-2 break-all text-sm text-fg-3"></p>
      </div>
    </div>
    <div data-devices class="mt-5 flex flex-wrap gap-2"></div>
    <div class="mt-6 flex gap-3 justify-end">
      <button data-toggle class="btn">Enable companion</button>
      <button data-renew class="btn" disabled>New code</button>
      <button data-close class="btn-primary">Done</button>
    </div>`
  document.body.appendChild(dialog)
  const query = <T extends HTMLElement>(s: string) => dialog.querySelector<T>(s)!
  let busy = false
  let closed = false
  let lastUrl = ""
  let deviceSignature = ""
  function render(next: ReceiverStatus) {
    if (closed) return
    const on = companionEnabled()
    query("[data-name]").textContent = next.name
    query("[data-code]").textContent = on ? formatReceiverPairCode(next.pairCode) : "—"
    query("[data-status]").textContent = on
      ? `Enter this code on your phone · renews in ${next.pairCodeExpiresInSeconds ?? 0}s. Paired phones stay connected.`
      : "Companion is off. This TV still plays on its own."
    query<HTMLButtonElement>("[data-toggle]").textContent = on ? "Turn off companion" : "Enable companion"
    query<HTMLButtonElement>("[data-renew]").disabled = !on
    const host = pairableReceiverIps(next.ips)[0]
    const url = on && host && next.port ? `http://${host}:${next.port}/companion` : ""
    query("[data-address]").textContent = url || (on ? "Connect this TV to your home network." : "")
    if (url !== lastUrl) {
      lastUrl = url
      const qr = query("[data-qr]")
      qr.classList.toggle("hidden", !url)
      qr.replaceChildren()
      if (url) {
        const code = qrcode(0, "M"); code.addData(url); code.make()
        // Library-generated SVG contains only the local address; never include a pairing key or code.
        qr.innerHTML = code.createSvgTag({ cellSize: 5, margin: 0, scalable: false })
        qr.setAttribute("aria-label", "Scan to open the local phone remote")
      }
    }
    const signature = JSON.stringify(next.pairedDevices)
    if (signature !== deviceSignature) {
      deviceSignature = signature
      const devices = query("[data-devices]"); devices.replaceChildren()
      for (const device of next.pairedDevices) {
        const button = document.createElement("button")
        button.className = "btn text-sm"
        button.textContent = `Forget ${device.deviceName}`
        button.addEventListener("click", () => void run(async () => {
          await invoke("receiver_revoke_device", { key: device.key })
          render(await invoke<ReceiverStatus>("receiver_status"))
        }))
        devices.appendChild(button)
      }
    }
  }
  async function run(work: () => Promise<unknown>) {
    if (busy || closed) return
    busy = true
    try { await work() } catch {
      if (!closed) query("[data-status]").textContent = "Could not connect. Check the TV’s network and try again."
    } finally { busy = false }
  }
  query("[data-toggle]").addEventListener("click", () => void run(async () => {
    if (companionEnabled()) {
      if (!getReceiverModeEnabled()) { await invoke("receiver_stop"); await stopAdvertisingReceiver() }
      window.AndroidVideo?.companionSetEnabled?.(false)
      localStorage.removeItem(KEY)
      render(await invoke<ReceiverStatus>("receiver_status"))
    } else render(await startPhoneCompanion())
  }))
  query("[data-renew]").addEventListener("click", () => void run(async () => render(await invoke<ReceiverStatus>("receiver_regenerate_code"))))
  query("[data-close]").addEventListener("click", () => dialog.close())
  const timer = setInterval(() => {
    if (companionEnabled()) void run(async () => render(await invoke<ReceiverStatus>("receiver_status")))
  }, 1000)
  dialog.addEventListener("close", () => { closed = true; clearInterval(timer); dialog.remove() }, { once: true })
  dialog.showModal()
  attachDialogSpatialNav(dialog, { defaultElement: "#phone-companion [data-toggle]" })
  query("[data-toggle]").focus()
  await run(async () => render(await invoke<ReceiverStatus>("receiver_status")))
}

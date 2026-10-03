export interface AppCommon {
  setScreenSaver(state: number, success?: () => void, failure?: () => void): void
}

/** Samsung's saver is disabled only while video is active in the foreground. */
export class ScreenSaver {
  private desired = true
  private requested?: boolean
  private sequence = 0
  status: 'unavailable' | 'pending' | 'on' | 'off' | 'failed' = 'unavailable'
  constructor(private api?: AppCommon) { this.request(true) }
  update(playing: boolean) { this.desired = !playing; if (this.requested !== this.desired) this.request(this.desired) }
  release() { this.desired = true; this.request(true) }
  private request(enabled: boolean) {
    if (!this.api) return
    this.requested = enabled; this.status = 'pending'
    const sequence = ++this.sequence
    try {
      this.api.setScreenSaver(enabled ? 1 : 0, () => {
        // A late OFF completion after pause/background must be corrected immediately.
        if (enabled !== this.desired) this.request(this.desired)
        else if (sequence === this.sequence) this.status = enabled ? 'on' : 'off'
      }, () => { if (sequence === this.sequence) this.status = 'failed' })
    } catch { if (sequence === this.sequence) this.status = 'failed' }
  }
}

/** Both vendors report visibility; pagehide/pageshow also cover restored browser pages. */
export function bindLifecycle(doc: Document, win: Window, suspend: () => void, resume: () => void) {
  let away = false
  const hide = () => { if (!away) { away = true; suspend() } }
  const show = () => { if (away && !doc.hidden) { away = false; resume() } }
  const visibility = () => doc.hidden ? hide() : show()
  doc.addEventListener('visibilitychange', visibility)
  win.addEventListener('pagehide', hide); win.addEventListener('pageshow', show)
  visibility()
  return () => { doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('pagehide', hide); win.removeEventListener('pageshow', show) }
}

import { languageScore, type Preferences } from './preferences'
import type { Player, PlayerTrack } from './player'

type Kind = PlayerTrack['kind']
type Languages = Pick<Preferences, 'audio' | 'subtitles'>
export function preferredTrack(tracks: PlayerTrack[], language: string) {
  let best: PlayerTrack | undefined, score = 0
  for (const track of tracks) {
    const current = track.disabled ? 0 : languageScore(track.language, language)
    if (current > score || current === score && current > 0 && track.active && !best?.active) { best = track; score = current }
  }
  return best
}

/** A preference gets one successful selection per stream; manual choices always take priority. */
export class TrackPreferences {
  private manualChoice = { audio: false, subtitle: false }
  private applied = { audio: false, subtitle: false }
  private selecting = new Set<Kind>()
  reset() { this.manualChoice = { audio: false, subtitle: false }; this.applied = { audio: false, subtitle: false }; this.selecting.clear() }
  manual(kind: Kind) { this.manualChoice[kind] = true }
  subtitleApplied() { this.applied.subtitle = true }
  subtitleLanguage(preferences: Languages, device: string) {
    if (this.manualChoice.subtitle || this.applied.subtitle || preferences.subtitles === 'off') return undefined
    return preferences.subtitles === 'auto' ? preferences.audio === 'auto' ? device || 'en' : preferences.audio : preferences.subtitles
  }
  apply(player: Player, preferences: Languages, device: string, tracks = player.tracks?.() || []) {
    let changed = false
    for (const kind of ['audio', 'subtitle'] as const) {
      if (this.manualChoice[kind] || this.applied[kind] || this.selecting.has(kind)) continue
      const available = tracks.filter(track => track.kind === kind)
      const language = kind === 'audio' ? preferences.audio === 'auto' ? device || 'en' : preferences.audio : this.subtitleLanguage(preferences, device)
      const off = kind === 'subtitle' && preferences.subtitles === 'off'
      if (off && !available.some(track => track.active)) continue
      const match = language ? preferredTrack(available, language) : undefined
      if (!off && !match) continue
      if (match && match.active) { this.applied[kind] = true; continue }
      this.selecting.add(kind)
      try {
        if (player.selectTrack?.(kind, off ? 'off' : match!.id)) {
          changed = true
          // Keep watching Off until a manual choice, so late default-enabled tracks are silenced too.
          if (!off) this.applied[kind] = true
        }
      } catch { /* A temporarily unavailable native engine can retry on a later playback tick. */ }
      finally { this.selecting.delete(kind) }
    }
    return changed
  }
}

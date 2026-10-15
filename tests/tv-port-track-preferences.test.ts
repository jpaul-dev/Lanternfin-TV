import { expect, it, vi } from 'vitest'
import { TrackPreferences, preferredTrack } from '../tv-app/track-preferences'
import { languageScore } from '../tv-app/preferences'
import type { Player, PlayerTrack } from '../tv-app/player'

const track = (id: string, kind: PlayerTrack['kind'], language: string, active = false): PlayerTrack => ({ id, kind, language, active, label: id })
const preferences = { audio: 'fr', subtitles: 'en' }
function setup() {
  let tracks: PlayerTrack[] = []
  const selectTrack = vi.fn(() => true)
  const player = { tracks: () => tracks, selectTrack } as unknown as Player
  return { player, selectTrack, controller: new TrackPreferences(), setTracks: (value: PlayerTrack[]) => { tracks = value } }
}

it('waits for late tracks, retries unavailable selections and applies each preference only once', () => {
  const { player, selectTrack, controller, setTracks } = setup()
  controller.apply(player, preferences, 'en-US'); expect(selectTrack).not.toHaveBeenCalled()
  setTracks([track('a1', 'audio', 'eng', true), { ...track('a2', 'audio', 'fra'), disabled: true }])
  controller.apply(player, preferences, 'en-US'); expect(selectTrack).not.toHaveBeenCalled()
  setTracks([track('a1', 'audio', 'eng', true), track('a2', 'audio', 'fra')])
  selectTrack.mockReturnValueOnce(false)
  controller.apply(player, preferences, 'en-US'); controller.apply(player, preferences, 'en-US')
  expect(selectTrack.mock.calls).toEqual([['audio', 'a2'], ['audio', 'a2']])
  setTracks([track('a2', 'audio', 'fra'), track('s1', 'subtitle', 'eng')])
  controller.apply(player, preferences, 'en-US'); controller.apply(player, preferences, 'en-US')
  expect(selectTrack).toHaveBeenCalledTimes(3); expect(selectTrack).toHaveBeenLastCalledWith('subtitle', 's1')
  expect(controller.subtitleLanguage(preferences, 'en-US')).toBeUndefined()
})

it('prefers exact regional tags and an already active match while retaining primary-language fallback', () => {
  const tracks = [track('pt', 'audio', 'pt'), track('br', 'audio', 'pt-BR', true), track('ptpt', 'audio', 'por_PT')]
  expect(preferredTrack(tracks, 'pt-PT')?.id).toBe('ptpt')
  expect(preferredTrack(tracks, 'pt-AO')?.id).toBe('br')
  expect(preferredTrack([{ ...tracks[2], disabled: true }, tracks[0]], 'pt-PT')?.id).toBe('pt')
  expect(languageScore(' fre_FR ', 'fr-fr')).toBe(2)
  expect(languageScore('und', 'und')).toBe(0); expect(languageScore(undefined, 'en')).toBe(0)
  expect(preferredTrack(tracks, 'en')).toBeUndefined()
  const { player, controller, setTracks, selectTrack } = setup()
  setTracks([track('fr', 'audio', 'fra', true), track('en', 'subtitle', 'eng', true)])
  controller.apply(player, preferences, 'en'); expect(selectTrack).not.toHaveBeenCalled()
  setTracks([track('fr', 'audio', 'fra'), track('en', 'subtitle', 'eng')])
  controller.apply(player, preferences, 'en'); expect(selectTrack).not.toHaveBeenCalled()
})

it('keeps late default captions Off until a manual choice and resets for the next stream', () => {
  const { player, controller, setTracks, selectTrack } = setup(), off = { audio: 'auto', subtitles: 'off' }
  expect(controller.subtitleLanguage(off, 'fr')).toBeUndefined()
  controller.apply(player, off, 'fr'); expect(selectTrack).not.toHaveBeenCalled()
  setTracks([track('en', 'subtitle', 'eng', true)]); controller.apply(player, off, 'fr')
  expect(selectTrack).toHaveBeenLastCalledWith('subtitle', 'off')
  setTracks([track('en', 'subtitle', 'eng')]); controller.apply(player, off, 'fr'); expect(selectTrack).toHaveBeenCalledOnce()
  setTracks([track('fr', 'subtitle', 'fra', true)]); controller.apply(player, off, 'fr'); expect(selectTrack).toHaveBeenCalledTimes(2)
  controller.manual('subtitle'); controller.apply(player, off, 'fr'); expect(selectTrack).toHaveBeenCalledTimes(2)
  controller.reset(); controller.apply(player, off, 'fr'); expect(selectTrack).toHaveBeenCalledTimes(3)
})

it('respects independent manual choices including external subtitles and resolves Auto from audio or device language', () => {
  const { player, controller, setTracks, selectTrack } = setup()
  expect(controller.subtitleLanguage({ audio: 'fr', subtitles: 'auto' }, 'en-US')).toBe('fr')
  expect(controller.subtitleLanguage({ audio: 'auto', subtitles: 'auto' }, 'pt-BR')).toBe('pt-BR')
  expect(controller.subtitleLanguage({ audio: 'auto', subtitles: 'auto' }, '')).toBe('en')
  controller.manual('audio'); setTracks([track('a', 'audio', 'fra'), track('s', 'subtitle', 'eng')])
  controller.apply(player, preferences, 'en'); expect(selectTrack.mock.calls).toEqual([['subtitle', 's']])
  controller.reset(); selectTrack.mockClear(); controller.manual('subtitle')
  expect(controller.subtitleLanguage(preferences, 'en')).toBeUndefined()
  controller.apply(player, preferences, 'en'); expect(selectTrack.mock.calls).toEqual([['audio', 'a']])
  controller.reset(); controller.subtitleApplied(); selectTrack.mockClear()
  controller.apply(player, preferences, 'en'); expect(selectTrack.mock.calls).toEqual([['audio', 'a']])
})

it('guards synchronous engine reports during selection and recovers after a native selection throws', () => {
  const { player, controller, setTracks, selectTrack } = setup()
  setTracks([track('a', 'audio', 'fra'), track('s', 'subtitle', 'eng')])
  selectTrack.mockImplementation(() => { controller.apply(player, preferences, 'en'); return true })
  controller.apply(player, preferences, 'en'); expect(selectTrack.mock.calls).toEqual([['audio', 'a'], ['subtitle', 's']])
  controller.reset(); selectTrack.mockClear().mockImplementationOnce(() => { throw new Error('Not ready') }).mockImplementation(() => true)
  controller.apply(player, preferences, 'en'); controller.apply(player, preferences, 'en')
  expect(selectTrack.mock.calls).toEqual([['audio', 'a'], ['subtitle', 's'], ['audio', 'a']])
})

import type { DawnReport } from './survival/dawn-report.ts'
import type { DayPhase } from './survival/daytime.ts'
import type { RotMood } from './survival/rot.ts'
import type { WeatherKind } from './survival/weather.ts'

/**
 * Haven Radio (research 7.2): a phone page (/radio, no 3D) that listens in on a world. It asks
 * for this small summary every RADIO_POLL_MS instead of holding a WebSocket: the server answers
 * from a copy it keeps for RADIO_CACHE_MS, so a listener costs one cheap request every 20 s and
 * never wakes the game loop or receives a snapshot. Type-only imports: the page (and its bundle)
 * pulls in nothing else from shared — it's importable as `@office-fps/shared/radio-feed`.
 *
 * Streamer night (research 6.4): a world an admin has opted in (POST /admin/api/streamer) lets listeners vote, once each per
 * night, on the next night's Rot mood. The winner is that night's mood at dusk.
 */

/** GET: the feed (`?world=`). */
export const RADIO_FEED_PATH = '/radio/feed'
/** POST `{ mood }`: a listener's vote on the coming night (`?world=`). */
export const RADIO_VOTE_PATH = '/radio/vote'

/** How often the page asks; slower while the world is empty, and never while it's hidden. */
export const RADIO_POLL_MS = 20_000
export const RADIO_POLL_EMPTY_MS = 60_000
/** How long the server reuses one feed for everybody (ms). */
export const RADIO_CACHE_MS = 15_000
/** Radio lines in the feed (newest last). */
export const RADIO_FEED_LINES = 12

/** The moods listeners can vote for, as the page shows them. */
export const MOOD_VOTE_LABELS: Record<RotMood, string> = {
  calm: 'Calm',
  fog: 'Fog',
  hunting: 'Hunting',
  choir: 'Choir',
}

export interface RadioVotes {
  /** Votes so far for the coming night's mood. */
  tally: Record<RotMood, number>
  /** The night the votes are for. */
  night: number
}

export interface RadioFeed {
  /** False if the server isn't running survival (nothing to listen to). */
  live: boolean
  world: string
  /** "Deadwood 2", or "Private world". */
  name: string
  /** Which night (1 = the world's first). */
  night: number
  /** Clock 0–1 (SurvivalShared.time), its phase and a "23:40" for people. */
  time: number
  phase: DayPhase
  clock: string
  weather: WeatherKind
  /** Tonight's mood (only once the radio has told it, i.e. at night). */
  mood?: RotMood
  /** People in the world right now. */
  survivors: number
  /** Haven: morale 0–100, its word, the world's day and days to the Red Night (0: today). */
  morale: number
  moraleWord: string
  day: number
  redIn: number
  /** Radio Free Deadwood's last lines, oldest first. */
  lines: string[]
  /** The last Dawn Report, if any night has been written up. */
  dawn?: DawnReport
  /** Present when the world is having a streamer night. */
  votes?: RadioVotes
  /** Server clock when written (ms): the page shows how old it is. */
  at: number
}

/** What a vote got back. */
export interface RadioVoteReply {
  ok: boolean
  /** Why not: 'off' (no streamer night), 'voted' (once a night), 'bad', 'busy'. */
  error?: 'off' | 'voted' | 'bad' | 'busy'
  votes?: RadioVotes
}

/** "21:36" for a clock 0–1 (daytime.ts): dawn (0.4) reads 06:00, nightfall (0.96) about 19:30. */
export function radioClock(time: number): string {
  const minutes = Math.floor(((((time - 0.4) % 1) + 1) % 1) * 24 * 60 + 6 * 60) % (24 * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

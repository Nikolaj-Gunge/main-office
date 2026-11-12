import { WeaponId } from './sim/weapons.ts'

/** Game modes the admin can pick. */
export const MODES = ['ffa', 'tdm', 'lms', 'gungame', 'infection'] as const
export type ModeId = (typeof MODES)[number]

export const MODE_NAMES: Record<ModeId, string> = {
  ffa: 'Free for all',
  tdm: 'Team deathmatch',
  lms: 'Last man standing',
  gungame: 'Gun game',
  infection: 'Infection',
}

/** Teams: 0 = none (free for all), 1 and 2 = the two sides of a team mode. */
export type TeamId = 0 | 1 | 2

/** Team names and colors per mode (index = TeamId). */
export const TEAMS: Partial<Record<ModeId, [null, TeamStyle, TeamStyle]>> = {
  tdm: [null, { name: 'Marketing', color: 0xd9483b }, { name: 'IT', color: 0x3b7bd9 }],
  infection: [null, { name: 'Survivors', color: 0x3b7bd9 }, { name: 'Infected', color: 0x5fbf3a }],
}

export interface TeamStyle {
  name: string
  color: number
}

/** Gun game: the weapon for each level, and kills needed to move up from it. */
export const GUN_GAME_LADDER: { weapon: WeaponId; kills: number }[] = [
  { weapon: WeaponId.Rifle, kills: 2 },
  { weapon: WeaponId.Shotgun, kills: 2 },
  { weapon: WeaponId.Sniper, kills: 2 },
  { weapon: WeaponId.Handgun, kills: 2 },
  { weapon: WeaponId.Knife, kills: 1 },
]

/** Infected run this much faster than survivors. */
export const INFECTED_SPEED = 1.2

/** Seconds the winner screen shows before the next round starts. */
export const ROUND_END_SECONDS = 8

/** Per-player match standing, sent to everyone. */
export interface MatchPlayer {
  id: number
  team: TeamId
  kills: number
  deaths: number
  headshots: number
  /** Gun game level (index into GUN_GAME_LADDER). */
  level: number
  /** Last man standing: out until the next round. */
  out: boolean
}

export interface RoundResult {
  /** Winner: a player (free for all, last man standing, gun game) or a team. */
  winnerId: number | null
  winnerTeam: TeamId
  /** One line, e.g. "IT wins 50 – 41" or "Karen wins". */
  headline: string
  /** Best-of lines for the winner screen. */
  awards: { title: string; playerId: number; value: string }[]
}

/** Everything the HUD needs about the current match (ServerMsg.Match). */
export interface MatchInfo {
  mode: ModeId
  phase: 'playing' | 'ended'
  /** Seconds left in this phase (round time, or the winner screen). */
  timeLeft: number
  scoreLimit: number
  teamScores: [number, number, number]
  players: MatchPlayer[]
  result: RoundResult | null
}

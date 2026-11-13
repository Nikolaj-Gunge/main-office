import { WeaponId } from './sim/weapons.ts'
import type { SurvivalShared } from './survival/protocol.ts'

/** Game modes the admin can pick. */
export const MODES = ['ffa', 'tdm', 'lms', 'gungame', 'infection', 'zombies', 'survival'] as const
export type ModeId = (typeof MODES)[number]

export const MODE_NAMES: Record<ModeId, string> = {
  ffa: 'Free for all',
  tdm: 'Team deathmatch',
  lms: 'Last man standing',
  gungame: 'Gun game',
  infection: 'Infection',
  zombies: 'Zombies (co-op)',
  survival: 'Survival (Deadwood)',
}

/** Teams: 0 = none (free for all), 1 and 2 = the two sides of a team mode. */
export type TeamId = 0 | 1 | 2

/** Team names and colors per mode (index = TeamId). */
export const TEAMS: Partial<Record<ModeId, [null, TeamStyle, TeamStyle]>> = {
  tdm: [null, { name: 'Marketing', color: 0xd9483b }, { name: 'IT', color: 0x3b7bd9 }],
  infection: [null, { name: 'Survivors', color: 0x3b7bd9 }, { name: 'Infected', color: 0x5fbf3a }],
  zombies: [null, { name: 'Survivors', color: 0x3b7bd9 }, { name: 'Zombies', color: 0x6f9a3a }],
  survival: [null, { name: 'Survivors', color: 0x3b7bd9 }, { name: 'The dead', color: 0x6f9a3a }],
}

export interface TeamStyle {
  name: string
  color: number
}

/** Gun game: the weapon for each level, and kills needed to move up from it. */
export const GUN_GAME_LADDER: { weapon: WeaponId; kills: number }[] = [
  { weapon: WeaponId.Rifle, kills: 2 },
  { weapon: WeaponId.Smg, kills: 2 },
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
  /** Zombies mode: where the team is on the co-op map. */
  coop?: CoopInfo
  /** Survival mode: the night, the story and what has been found. */
  survival?: SurvivalShared
}

/** Co-op progress (zombies mode). */
export interface CoopInfo {
  /** Index into the map's CoopDef.stages; equal to its length once the team escaped. */
  stage: number
  /** 0–1 towards this stage's goal. */
  progress: number
  /** Kill goals: kills so far and needed. */
  kills?: [number, number]
  /** Activate goals: bit i set = spot i is done. */
  parts?: number
  /** Defend goals: what's left of the thing's health, 0–1. */
  health?: number
  /** Bit i set = gate i is open. */
  gates: number
  zombiesAlive: number
  /** Seconds since the run started (the clock on the HUD). */
  elapsed: number
}

/** Zombie kinds (PlayerJoined.kind): 0 is a person (or a normal bot). */
export const ZombieKind = {
  Walker: 1,
  Runner: 2,
  // Survival only:
  /** Huge and slow; takes a magazine or three. */
  Brute: 3,
  /** Screams when it sees you, and everything nearby comes running. */
  Screamer: 4,
  /** Only moves while nobody is looking at it. */
  Stalker: 5,
} as const
export type ZombieKind = (typeof ZombieKind)[keyof typeof ZombieKind]

/** How big each kind of zombie is next to a person (bodies, hitboxes and reach scale with it). */
export const ZOMBIE_SCALE: Record<number, number> = {
  [ZombieKind.Brute]: 1.38,
  [ZombieKind.Screamer]: 0.92,
  [ZombieKind.Stalker]: 1.12,
}
export function zombieScale(kind: number): number {
  return ZOMBIE_SCALE[kind] ?? 1
}

/** Is gate `id` open in this bitmask? */
export function gateOpen(gates: number, id: number): boolean {
  return (gates & (1 << id)) !== 0
}

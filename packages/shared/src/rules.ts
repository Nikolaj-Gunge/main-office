import { DEFAULT_MAP_ID, MAPS } from './maps/index.ts'
import { MODES, type ModeId } from './modes.ts'
import { DEFAULT_MOVEMENT, type MovementConfig } from './sim/movement-config.ts'
import type { WeaponRules } from './sim/weapon-sim.ts'

/** Player looks the admin can put everyone in (hitboxes are the same for all of them). */
export const SKINS = ['slime', 'worker', 'robot'] as const
export type SkinId = (typeof SKINS)[number]

/** Main weapon everyone spawns with, next to the handgun ('none' = find one on the floor). */
export const SPAWN_WEAPONS = ['none', 'rifle', 'sniper', 'shotgun', 'random'] as const
export type SpawnWeapon = (typeof SPAWN_WEAPONS)[number]

/** How well server bots aim and react. */
export const BOT_SKILLS = ['easy', 'normal', 'hard'] as const
export type BotSkill = (typeof BOT_SKILLS)[number]

/** What plays when you get a kill (on top of the kill ding). */
export const JINGLES = ['off', 'arcade', 'fanfare', 'airhorn'] as const
export type JingleId = (typeof JINGLES)[number]

/**
 * Server-wide game settings, changed live from the admin page. The server owns them and sends
 * them to every client: anything that affects movement or shooting must be applied on both
 * sides, or prediction would disagree with the server.
 */
export interface GameRules {
  map: string
  mode: ModeId
  /** Round length (minutes) and the score that ends it early (kills, or team kills). */
  timeLimit: number
  scoreLimit: number
  /** Move to the next map after every round. */
  mapRotation: boolean
  skin: SkinId
  jingles: JingleId
  /** Spawn loadout: the handgun plus this (in hand). Applies from each player's next spawn. */
  spawnWeapon: SpawnWeapon
  /** Server-side bots playing along, and how good they are. */
  bots: number
  botSkill: BotSkill
  /** Multipliers on the normal values (1 = normal). */
  gravity: number
  speed: number
  jump: number
  /** Body size: 0.5 = tiny people (hitboxes and capsule shrink with it). */
  playerScale: number
  /** Weapon spread: 0 = every bullet goes exactly where you aim. */
  spread: number
  /** Camera recoil kick. */
  recoil: number
  damage: number
  /** Any hit kills. */
  oneShot: boolean
  /** Only headshots do damage (they always kill). */
  headshotsOnly: boolean
  /** Reloading never uses up spare ammo. */
  infiniteAmmo: boolean
  respawnSeconds: number
}

export const DEFAULT_RULES: GameRules = {
  map: DEFAULT_MAP_ID,
  mode: 'ffa',
  timeLimit: 10,
  scoreLimit: 30,
  mapRotation: false,
  skin: 'slime',
  jingles: 'arcade',
  spawnWeapon: 'none',
  bots: 0,
  botSkill: 'normal',
  gravity: 1,
  speed: 1,
  jump: 1,
  playerScale: 1,
  spread: 1,
  recoil: 1,
  damage: 1,
  oneShot: false,
  headshotsOnly: false,
  infiniteAmmo: false,
  respawnSeconds: 3,
}

/** Allowed range of every numeric rule (the admin page builds its sliders from this). */
export const RULE_RANGES = {
  gravity: { min: 0.1, max: 2, step: 0.05 },
  speed: { min: 0.5, max: 2, step: 0.05 },
  jump: { min: 0.5, max: 2.5, step: 0.05 },
  playerScale: { min: 0.4, max: 1.25, step: 0.05 },
  spread: { min: 0, max: 2, step: 0.05 },
  recoil: { min: 0, max: 2, step: 0.05 },
  damage: { min: 0.25, max: 4, step: 0.05 },
  respawnSeconds: { min: 0, max: 10, step: 0.5 },
  bots: { min: 0, max: 10, step: 1 },
  timeLimit: { min: 1, max: 30, step: 1 },
  scoreLimit: { min: 5, max: 150, step: 5 },
} as const satisfies Partial<Record<keyof GameRules, { min: number; max: number; step: number }>>

type NumericRule = keyof typeof RULE_RANGES
const BOOLEAN_RULES = ['oneShot', 'headshotsOnly', 'infiniteAmmo', 'mapRotation'] as const

/**
 * Applies an untrusted partial update (from the admin page or storage) on top of `base`.
 * Unknown keys and invalid values are ignored; numbers are clamped to their range.
 */
export function mergeRules(base: GameRules, update: unknown): GameRules {
  const next = { ...base }
  if (typeof update !== 'object' || update === null) return next
  const u = update as Record<string, unknown>
  if (typeof u.map === 'string' && u.map in MAPS) next.map = u.map
  if (typeof u.mode === 'string' && (MODES as readonly string[]).includes(u.mode)) {
    next.mode = u.mode as ModeId
  }
  if (typeof u.skin === 'string' && (SKINS as readonly string[]).includes(u.skin)) {
    next.skin = u.skin as SkinId
  }
  if (typeof u.jingles === 'string' && (JINGLES as readonly string[]).includes(u.jingles)) {
    next.jingles = u.jingles as JingleId
  }
  if (
    typeof u.spawnWeapon === 'string' &&
    (SPAWN_WEAPONS as readonly string[]).includes(u.spawnWeapon)
  ) {
    next.spawnWeapon = u.spawnWeapon as SpawnWeapon
  }
  for (const key of Object.keys(RULE_RANGES) as NumericRule[]) {
    const value = u[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = RULE_RANGES[key]
    next[key] = Math.min(max, Math.max(min, value))
  }
  next.bots = Math.round(next.bots)
  if (typeof u.botSkill === 'string' && (BOT_SKILLS as readonly string[]).includes(u.botSkill)) {
    next.botSkill = u.botSkill as BotSkill
  }
  for (const key of BOOLEAN_RULES) {
    if (typeof u[key] === 'boolean') next[key] = u[key]
  }
  return next
}

/** The movement config everyone simulates with under these rules. */
export function movementFor(
  rules: GameRules,
  base: MovementConfig = DEFAULT_MOVEMENT,
): MovementConfig {
  const s = rules.playerScale
  return {
    ...base,
    radius: base.radius * s,
    standHeight: base.standHeight * s,
    crouchHeight: base.crouchHeight * s,
    standEyeHeight: base.standEyeHeight * s,
    crouchEyeHeight: base.crouchEyeHeight * s,
    crouchJumpLift: base.crouchJumpLift * s,
    // Tiny people still climb the stairs (0.25 m steps).
    stepHeight: Math.max(0.3, base.stepHeight * s),
    walkSpeed: base.walkSpeed * rules.speed,
    crouchSpeed: base.crouchSpeed * rules.speed,
    gravity: base.gravity * rules.gravity,
    jumpVelocity: base.jumpVelocity * rules.jump,
  }
}

export function weaponRulesFor(rules: GameRules): WeaponRules {
  return { spreadScale: rules.spread, infiniteAmmo: rules.infiniteAmmo }
}

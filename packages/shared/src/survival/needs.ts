/**
 * Needs as buffs, and the small things that go wrong out there. Eating and drinking well is a
 * bonus, not a chore: above 70 you are Well fed / Hydrated and run longer, breathe back faster
 * and mend. Sitting by a lit fire (or sleeping in a bunk) leaves you Rested for twenty minutes.
 * Going without hurts slowly and never kills on its own (health stops at STARVE_FLOOR).
 *
 * Then the stakes: rain and lakes soak you (Wet), a wet night without warm clothes chills you
 * (Cold), a long fall sprains an ankle, and bad food or dirty water turns your stomach (Food
 * poisoning). Each says on the HUD what it does and how to fix it.
 *
 * Pure functions: the server runs them (survival/needs.ts there), the client reads the result
 * (SurvivalSelf.needs) and moves with the same tuning (tuneMovement).
 */

import type { MovementConfig } from '../sim/movement-config.ts'
import { GEAR, type WearSlot } from './gear.ts'

/** What's going on with you besides hunger and thirst (saved with the character). */
export interface Needs {
  /** Seconds of Rested left (0: not rested). */
  rested: number
  /** Seconds sat by a fire so far, towards Rested. */
  resting: number
  /** How soaked you are, 0–100. */
  wet: number
  /** How chilled, 0–100 (Cold from COLD_AT). */
  chill: number
  /** Seconds of sprained ankle left. */
  sprain: number
  /** Seconds of food poisoning left. */
  sick: number
}

export const freshNeeds = (): Needs => ({
  rested: 0,
  resting: 0,
  wet: 0,
  chill: 0,
  sprain: 0,
  sick: 0,
})

/** Above this hunger (thirst) you are Well fed (Hydrated). */
export const WELL_FED = 70
export const HYDRATED = 70
/** At or below this you are Starving (Parched); at 0 it costs health. */
export const STARVING_AT = 10
/** Hunger and thirst alone never take you below this much health. */
export const STARVE_FLOOR = 15
/** Seconds sitting by a fire to be Rested, and how long Rested lasts. */
export const REST_SIT_SECONDS = 20
export const RESTED_SECONDS = 20 * 60
/** Rested slows the bite by this share (0.1 = the clock runs 10 % slower). */
export const RESTED_INFECTION_SLOWDOWN = 0.1
/** Wet from this soaked, Cold from this chilled. */
export const WET_AT = 30
export const COLD_AT = 50
/** A fall further than this (m) sprains an ankle, for SPRAIN_SECONDS. */
export const SPRAIN_FALL = 4
export const SPRAIN_SECONDS = 3 * 60
export const SICK_SECONDS = 2 * 60
/** Chance per second of throwing up while food-poisoned, and what it costs. */
export const VOMIT_CHANCE = 0.015
export const VOMIT_HUNGER = 8
export const VOMIT_THIRST = 6
/** Hunger and thirst lost per second at the normal rate (0–100 scales). */
export const HUNGER_PER_SECOND = 100 / (45 * 60)
export const THIRST_PER_SECOND = 100 / (30 * 60)

export type EffectId =
  | 'fed'
  | 'hydrated'
  | 'rested'
  | 'starving'
  | 'parched'
  | 'wet'
  | 'cold'
  | 'sprain'
  | 'sick'

export interface EffectInfo {
  name: string
  /** A one-character icon for the HUD. */
  icon: string
  /** One line: what it does, and (for the bad ones) how to fix it. */
  tip: string
  good: boolean
}

/** Every buff and status, in the order the HUD shows them (good first). */
export const EFFECTS: Readonly<Record<EffectId, EffectInfo>> = {
  fed: {
    name: 'Well fed',
    icon: '◆',
    tip: 'Breath comes back faster and wounds mend. Keep food above 70.',
    good: true,
  },
  hydrated: {
    name: 'Hydrated',
    icon: '◇',
    tip: 'You can run longer. Keep water above 70.',
    good: true,
  },
  rested: {
    name: 'Rested',
    icon: '☾',
    tip: 'More breath, steadier hands, and the bite spreads slower. Sit by a fire or sleep to renew.',
    good: true,
  },
  starving: {
    name: 'Starving',
    icon: '▽',
    tip: 'Eat something. Empty, it costs health (never below 15).',
    good: false,
  },
  parched: {
    name: 'Parched',
    icon: '▽',
    tip: 'Drink something. Empty, it costs health (never below 15).',
    good: false,
  },
  wet: {
    name: 'Wet',
    icon: '≈',
    tip: 'You chill fast at night. Dry off by a fire or indoors.',
    good: false,
  },
  cold: {
    name: 'Cold',
    icon: '*',
    tip: 'Shaking hands, slow breath. Get to a fire, indoors, or put on warm clothes.',
    good: false,
  },
  sprain: {
    name: 'Sprained ankle',
    icon: '↯',
    tip: "You can't sprint properly. Bind it with a bandage, or wait it out.",
    good: false,
  },
  sick: {
    name: 'Food poisoning',
    icon: '~',
    tip: 'Queasy and short of breath; you may throw up. Antibiotics settle it, or wait.',
    good: false,
  },
}

export const EFFECT_ORDER = Object.keys(EFFECTS) as EffectId[]

/** Who has which needs: the bits of SurvivalSelf this file reads. */
export interface NeedsHolder {
  hunger: number
  thirst: number
  needs?: Needs | undefined
}

/** The buffs and statuses someone has right now, in EFFECT_ORDER. */
export function effectsOf(self: NeedsHolder): EffectId[] {
  const n = self.needs ?? freshNeeds()
  const on: Record<EffectId, boolean> = {
    fed: self.hunger > WELL_FED,
    hydrated: self.thirst > HYDRATED,
    rested: n.rested > 0,
    starving: self.hunger <= STARVING_AT,
    parched: self.thirst <= STARVING_AT,
    wet: n.wet >= WET_AT,
    cold: n.chill >= COLD_AT,
    sprain: n.sprain > 0,
    sick: n.sick > 0,
  }
  return EFFECT_ORDER.filter((id) => on[id])
}

/** How warm and how rainproof everything worn is, all told. */
export function wornWarmth(wear: Partial<Record<WearSlot, string>> | undefined): {
  warmth: number
  dry: number
} {
  let warmth = 0
  let dry = 0
  for (const id of Object.values(wear ?? {})) {
    const g = id ? GEAR[id] : undefined
    warmth += g?.warmth ?? 0
    dry += g?.dry ?? 0
  }
  return { warmth, dry: Math.min(0.9, dry) }
}

/** Where you are, as far as staying warm and dry goes (worked out by the server). */
export interface Surroundings {
  /** How dark and cold the hour is: 1 night, 0.5 dusk and dawn, 0 day. */
  night: number
  /** How hard it rains, 0–1. */
  rain: number
  /** Under a roof (out of the rain and the wind). */
  indoors: boolean
  /** Within reach of a lit fire. */
  byFire: boolean
  /** In a lake. */
  inWater: boolean
  /** Not walking about (sitting it out). */
  still: boolean
}

/**
 * Moves wet, chill, resting and the timers on by `dt` seconds. Returns true the moment you
 * become Rested by the fire (not when it is merely topped up).
 */
export function stepNeeds(
  n: Needs,
  at: Surroundings,
  clothes: { warmth: number; dry: number },
  dt: number,
): boolean {
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  let becameRested = false
  n.rested = Math.max(0, n.rested - dt)
  n.sprain = Math.max(0, n.sprain - dt)
  n.sick = Math.max(0, n.sick - dt)

  // Rested: sit by the fire a while.
  if (at.byFire && at.still) {
    n.resting += dt
    if (n.resting >= REST_SIT_SECONDS) {
      becameRested = n.rested === 0
      n.rested = RESTED_SECONDS
      n.resting = 0
    }
  } else n.resting = 0

  // Wet: soaked in the lake or the rain; dried by a fire, a roof, or slowly by the air.
  if (at.inWater) n.wet = clamp(n.wet + 40 * dt)
  else if (!at.indoors && at.rain > 0.05)
    n.wet = clamp(n.wet + at.rain * 3 * (1 - clothes.dry) * dt)
  else n.wet = clamp(n.wet - (at.byFire ? 4 : at.indoors ? 1 : at.night > 0.5 ? 0.15 : 0.3) * dt)

  // Cold: the night, wet clothes and the rain against what you wear. A fire or a roof warms.
  if (at.byFire || at.indoors) n.chill = clamp(n.chill - (at.byFire ? 6 : 2.5) * dt)
  else {
    const cold = at.night + n.wet / 100 + at.rain * 0.3 - clothes.warmth
    n.chill = clamp(n.chill + (cold > 1 ? (cold - 1) * 1.5 : -1) * dt)
  }
  return becameRested
}

/** Health after `hurt` from hunger and thirst alone: it never takes you below STARVE_FLOOR. */
export function starveHurt(health: number, hurt: number): number {
  return Math.max(Math.min(health, STARVE_FLOOR), health - hurt)
}

/**
 * Hunger and thirst lost per second. `scale` multiplies both: one place to slow (or speed) the
 * drain for somebody (e.g. a newcomer's first day).
 */
export function needsDrain(scale = 1): { hunger: number; thirst: number } {
  return { hunger: HUNGER_PER_SECOND * scale, thirst: THIRST_PER_SECOND * scale }
}

/** How fast the bite's clock runs for someone (1 normal; Rested slows it). */
export function infectionRate(needs: Needs | undefined): number {
  return needs && needs.rested > 0 ? 1 - RESTED_INFECTION_SLOWDOWN : 1
}

/** The effects that change how you move, as one string (to notice when it changes). */
export function movementKey(effects: readonly EffectId[], fitness = 1): string {
  const key = effects.filter((e) => MOVES.has(e)).join(',')
  return fitness === 1 ? key : `${key}|${fitness}`
}
const MOVES = new Set<EffectId>(['fed', 'hydrated', 'rested', 'cold', 'sprain', 'sick'])

/**
 * How someone moves with these effects (a new config; `base` is left alone). Breath for sprinting
 * lasts longer Hydrated or Rested and comes back faster Well fed, slower Cold or sick; a sprained
 * ankle barely runs; the Fitness skill (skills.ts) adds breath. Server and client both apply it, so
 * prediction agrees.
 */
export function tuneMovement(
  base: MovementConfig,
  effects: readonly EffectId[],
  fitness = 1,
): MovementConfig {
  const has = new Set(effects)
  // Fitness (skills.ts): more breath for running, × seconds.
  let sprint = fitness
  let breath = 1
  if (has.has('hydrated')) sprint *= 1.25
  if (has.has('rested')) sprint *= 1.15
  if (has.has('fed')) breath *= 0.8
  if (has.has('cold')) breath *= 1.35
  if (has.has('sick')) breath *= 1.5
  return {
    ...base,
    sprintSeconds: base.sprintSeconds * sprint,
    breathSeconds: base.breathSeconds * breath,
    sprintMultiplier: has.has('sprain')
      ? 1 + (base.sprintMultiplier - 1) * 0.3
      : base.sprintMultiplier,
  }
}

/** How much your aim shivers (radians, peak): Cold shakes it; Rested steadies it. */
export function shiverOf(effects: readonly EffectId[]): number {
  if (!effects.includes('cold')) return 0
  return effects.includes('rested') ? 0.0018 : 0.0035
}

import { DAY_SECONDS, type Poi, ZombieKind } from '@office-fps/shared'

/**
 * The newcomer's shield (ROADMAP 2.5): the first hour shouldn't be the last. For a new
 * character's first in-game day hunger and thirst drain at half speed and the woods around
 * Hollis' cabin hold fewer of the dead, and only walkers; die in the first ten minutes and you
 * wake where you started with everything you had.
 */

/** How long a new character is shielded (s of being alive): one in-game day. */
export const SHIELD_SECONDS = DAY_SECONDS
/** Dying before this (s alive) costs nothing: you wake where you started with your things. */
export const KEEP_LOOT_SECONDS = 10 * 60
/** The gentle woods: this far around Hollis' cabin (m). */
export const SHIELD_RADIUS = 150
/** How fast hunger and thirst drain while shielded (× normal). */
export const SHIELD_DRAIN = 0.5

/** Still new (age: seconds alive; old saves without one aren't). */
export function shielded(age: number | undefined): boolean {
  return age !== undefined && age < SHIELD_SECONDS
}

/** How fast hunger and thirst go down for somebody this old. */
export function drainFactor(age: number | undefined): number {
  return shielded(age) ? SHIELD_DRAIN : 1
}

/** Dying now keeps what you carry. */
export function keepsLoot(age: number | undefined): boolean {
  return age !== undefined && age < KEEP_LOOT_SECONDS
}

/** Hollis' cabin, where newcomers wake. */
export function startPoi(pois: readonly Poi[]): Poi | undefined {
  return pois.find((p) => p.kind === 'start')
}

/** Is this point within the gentle woods around the cabin? */
export function inShield(pois: readonly Poi[], at: { x: number; z: number }): boolean {
  const cabin = startPoi(pois)
  return !!cabin && Math.hypot(at.x - cabin.x, at.z - cabin.z) < SHIELD_RADIUS
}

/** What may walk in the gentle woods: only walkers (no runners, brutes, screamers…). */
export function gentleKind(_kind: ZombieKind): ZombieKind {
  return ZombieKind.Walker
}

/** How many of the dead the gentle woods hold, of the `n` they otherwise would: half, rounded down. */
export function gentleCount(n: number): number {
  return Math.floor(Math.max(0, n) / 2)
}

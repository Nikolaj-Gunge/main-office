import { DAWN, NIGHTFALL } from './daytime.ts'

/**
 * Haven's gate at night (apps/server/src/survival/haven-gate.ts). By day it stands open. From
 * nightfall to dawn it is shut, and only somebody inside can open it: E held on the winch beside
 * it, a few loud seconds of chain that every corpse in earshot hears. Once up it stays up a
 * little while and then drops shut on its own (never on top of anybody standing in it).
 * Somebody outside can only bang on it and hope. The dead at a shut gate batter it, and enough
 * of them break it open for a while (a Red Night does).
 */

/** The gate's number in the world's gate bitmask (SurvivalShared.gates; MapBox.gate). */
export const HAVEN_GATE = 8
/** The palisade's half-width (m from Haven's middle): the gate is in its north wall, at z = -R. */
export const HAVEN_WALL = 30
/** How wide the gateway is (m). */
export const HAVEN_GATE_WIDTH = 5
/** The winch, in Haven's own coordinates (just inside, east of the gate). */
export const HAVEN_CRANK: [x: number, z: number] = [3.9, -29.1]
/** Its key as an interactable, and the outside of the gate's (to bang on). */
export const HAVEN_CRANK_KEY = 'haven_crank'
export const HAVEN_KNOCK_KEY = 'haven_knock'
/** Seconds of cranking to get it up. Let go early and it slides back down this fast (per s). */
export const CRANK_SECS = 3
export const CRANK_SLIP = 0.6
/** Within this of the winch (m) you can turn it. */
export const CRANK_REACH = 2.4
/** How far the chain is heard (m): the dead come to look. */
export const CRANK_NOISE = 55
/** Once up, it stays up this long (s) after the last hand comes off the winch. */
export const GATE_HOLD_SECS = 12
/** How much battering it takes (each of the dead at it costs this much a second) … */
export const GATE_HP = 240
export const GATE_BASH = 6
/** … and how long it hangs broken open once it gives (s). */
export const GATE_BROKEN_SECS = 40
/** How high the gate rises when open (m; the client lifts it, the colliders just go). */
export const GATE_LIFT = 2.9

/** Is it the time of day the gate is kept shut (nightfall to dawn)? */
export function gateNight(time: number): boolean {
  const u = ((time % 1) + 1) % 1
  return u >= NIGHTFALL || u < DAWN
}

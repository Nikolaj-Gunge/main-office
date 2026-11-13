import type { MapBox } from '../maps/types.ts'
import type { BoardSpot } from './types.ts'

/**
 * Barricades: planks nailed across a doorway or window (see BoardSpot). While a gap has at least
 * one plank it is solid for everyone, living and dead; the dead batter at it until the last
 * plank gives. Server and client build the same colliders from the same plank counts
 * (physics/world.ts setBarricades), so prediction matches.
 */

/** Planks a gap takes. */
export const MAX_PLANKS = 4
/** How much battering one plank takes (zombie bash damage, see the horde's KINDS). */
export const PLANK_HP = 140
/** The item nailed up, one per plank. */
export const PLANK_ITEM = 'planks'
/** How far you reach to nail or pull a plank (m). */
export const BOARD_REACH = 2.4

/** Planks still up for this much battering left. */
export function planksFor(hp: number): number {
  return hp <= 0 ? 0 : Math.min(MAX_PLANKS, Math.ceil(hp / PLANK_HP))
}

/** The point you look at to board a gap up: its middle. */
export function spotCentre(s: BoardSpot): { x: number; y: number; z: number } {
  return { x: s.x, y: s.y + s.h / 2, z: s.z }
}

/** The solid block a boarded gap becomes (centre and half extents). */
export function spotBlock(s: BoardSpot): {
  center: [number, number, number]
  half: [number, number, number]
} {
  const depth = 0.16
  return {
    center: [s.x, s.y + s.h / 2, s.z],
    half: s.alongX ? [s.w / 2, s.h / 2, depth] : [depth, s.h / 2, s.w / 2],
  }
}

/**
 * The planks you see across a gap: boards at set heights, each a little askew, overlapping the
 * frame on both sides. The first plank goes across the middle, then low, high, and the gaps.
 */
export function plankBoxes(s: BoardSpot, planks: number): MapBox[] {
  const order = s.door ? [0.45, 0.15, 0.78, 0.62] : [0.5, 0.2, 0.8, 0.35]
  const boxes: MapBox[] = []
  for (let i = 0; i < Math.min(planks, MAX_PLANKS); i++) {
    const y = s.y + s.h * (order[i] as number)
    const tilt = (i % 2 === 0 ? 1 : -1) * (0.08 + ((i * 37) % 5) * 0.025)
    const length = s.w + 0.35
    boxes.push({
      center: [s.x, y, s.z],
      size: s.alongX ? [length, 0.2, 0.05] : [0.05, 0.2, length],
      rotation: s.alongX ? [0, 0, tilt] : [tilt, 0, 0],
      material: 'wood',
      collide: false,
    })
  }
  return boxes
}

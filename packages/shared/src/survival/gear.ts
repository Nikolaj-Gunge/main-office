/**
 * Clothes and gear you wear in survival: one thing on your head, one on your body, one on your
 * legs and one on your feet. Each does a little (armour, pockets, staying unseen or unheard) and
 * all four show on you, so other people see the helmet, the vest, the jeans and the boots.
 * Nothing worn still shows: a new character starts in a white tank top and grey joggers,
 * barefoot (look 0 of the body, legs and feet).
 */

import { FEET_LOOKS, LEGS_LOOKS } from '../appearance.ts'

export type WearSlot = 'head' | 'body' | 'legs' | 'feet'

/** Every slot, head to toe (the backpack's "Wearing" list goes in this order). */
export const WEAR_SLOTS: readonly WearSlot[] = ['head', 'body', 'legs', 'feet']

export interface WearStats {
  slot: WearSlot
  /** What it looks like on a body (see the *_LOOKS tables; 0 = the slot's default look). */
  look: number
  /** Share of damage it stops where it covers you (head hits for head gear, the rest otherwise). */
  armour?: number
  /** How much its pockets hold, roughly (kg); the pocket grid itself is in grid.ts. */
  pockets?: number
  /** The dead see you this much less far (0.2 = 20 % less). */
  stealth?: number
  /** Your footsteps carry this much less far. */
  quiet?: number
}

/** Head looks (bits 0–3 of the replicated gear value). */
export const HEAD_LOOKS = {
  none: 0,
  cap: 1,
  beanie: 2,
  hardhat: 3,
  helmet: 4,
  bandana: 5,
  cowboy: 6,
  gasmask: 7,
} as const

/** Body looks (bits 4–7). 0 = the starting white tank top. */
export const BODY_LOOKS = {
  none: 0,
  hoodie: 1,
  jacket: 2,
  camo: 3,
  police: 4,
  military: 5,
  raincoat: 6,
  flannel: 7,
} as const

/** Footsteps carry this much further barefoot (no shoes: slapping feet, crunching gravel). */
export const BAREFOOT_NOISE = 0.1

/** Item id → what wearing it does. */
export const GEAR: Readonly<Record<string, WearStats>> = {
  cap: { slot: 'head', look: HEAD_LOOKS.cap },
  beanie: { slot: 'head', look: HEAD_LOOKS.beanie, stealth: 0.05 },
  bandana: { slot: 'head', look: HEAD_LOOKS.bandana, quiet: 0.05 },
  cowboyhat: { slot: 'head', look: HEAD_LOOKS.cowboy },
  hardhat: { slot: 'head', look: HEAD_LOOKS.hardhat, armour: 0.25 },
  helmet: { slot: 'head', look: HEAD_LOOKS.helmet, armour: 0.45 },
  gasmask: { slot: 'head', look: HEAD_LOOKS.gasmask, armour: 0.1, quiet: 0.1 },
  hoodie: { slot: 'body', look: BODY_LOOKS.hoodie, pockets: 3 },
  flannel: { slot: 'body', look: BODY_LOOKS.flannel, pockets: 2 },
  raincoat: { slot: 'body', look: BODY_LOOKS.raincoat, pockets: 4, quiet: -0.1 },
  jacket: { slot: 'body', look: BODY_LOOKS.jacket, pockets: 6, armour: 0.08 },
  camojacket: { slot: 'body', look: BODY_LOOKS.camo, pockets: 5, stealth: 0.25 },
  policevest: { slot: 'body', look: BODY_LOOKS.police, armour: 0.25, pockets: 2 },
  militaryvest: { slot: 'body', look: BODY_LOOKS.military, armour: 0.4, pockets: 6 },
  jeans: { slot: 'legs', look: LEGS_LOOKS.jeans, pockets: 1, armour: 0.03 },
  cargopants: { slot: 'legs', look: LEGS_LOOKS.cargo, pockets: 4 },
  camopants: { slot: 'legs', look: LEGS_LOOKS.camo, pockets: 2, stealth: 0.1 },
  worktrousers: { slot: 'legs', look: LEGS_LOOKS.work, pockets: 2, armour: 0.05 },
  policetrousers: { slot: 'legs', look: LEGS_LOOKS.police, pockets: 2, armour: 0.04 },
  sneakers: { slot: 'feet', look: FEET_LOOKS.sneakers, quiet: 0.15 },
  boots: { slot: 'feet', look: FEET_LOOKS.boots, quiet: 0.3 },
  militaryboots: { slot: 'feet', look: FEET_LOOKS.military, quiet: 0.2, armour: 0.02 },
}

/**
 * What a set of worn items looks like, packed for the wire (u16):
 * head | body << 4 | legs << 8 | feet << 12.
 */
export function gearLooks(worn: readonly (string | null | undefined)[]): number {
  const looks = { head: 0, body: 0, legs: 0, feet: 0 }
  for (const id of worn) {
    const g = id ? GEAR[id] : undefined
    if (g) looks[g.slot] = g.look & 15
  }
  return looks.head | (looks.body << 4) | (looks.legs << 8) | (looks.feet << 12)
}

export const headLook = (gear: number): number => gear & 15
export const bodyLook = (gear: number): number => (gear >> 4) & 15
export const legsLook = (gear: number): number => (gear >> 8) & 15
export const feetLook = (gear: number): number => (gear >> 12) & 15

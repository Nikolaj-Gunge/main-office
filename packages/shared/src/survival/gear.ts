/**
 * Clothes and gear you wear in survival: one thing on your head, one on your body, one on your
 * feet. Each does a little (armour, pockets, staying unseen or unheard) and the head and body
 * pieces show on you, so other people see the helmet and the vest.
 */

export type WearSlot = 'head' | 'body' | 'feet'

export interface WearStats {
  slot: WearSlot
  /** What it looks like on a body (see GEAR_LOOKS; 0 = nothing shown). */
  look: number
  /** Share of damage it stops where it covers you (head hits for head gear, the rest for body). */
  armour?: number
  /** Extra carrying room (kg). */
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

/** Body looks (bits 4–7). */
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
  sneakers: { slot: 'feet', look: 0, quiet: 0.15 },
  boots: { slot: 'feet', look: 0, quiet: 0.3, armour: 0 },
}

/** What a set of worn items looks like, packed for the wire: head look | body look << 4. */
export function gearLooks(worn: readonly (string | null | undefined)[]): number {
  let head = 0
  let body = 0
  for (const id of worn) {
    const g = id ? GEAR[id] : undefined
    if (g?.slot === 'head') head = g.look
    if (g?.slot === 'body') body = g.look
  }
  return (head & 15) | ((body & 15) << 4)
}

export const headLook = (gear: number): number => gear & 15
export const bodyLook = (gear: number): number => (gear >> 4) & 15

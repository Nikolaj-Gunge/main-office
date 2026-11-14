/**
 * What a player looks like (chosen in the character creator, saved on their device, sent on
 * join and replicated to everyone). Visual only: hitboxes don't change with it.
 * File: packages/shared/src/appearance.ts (exported from packages/shared/src/index.ts).
 */

export interface Appearance {
  /** Build: 0 = masculine, 1 = feminine (shoulders, hips, chest, jaw). */
  body: number
  /** Index into SKIN_TONES. */
  skin: number
  /** Index into HAIR_STYLES (0 = bald). */
  hair: number
  /** Index into HAIR_COLORS. */
  hairColor: number
  /** Index into EYE_COLORS. */
  eyes: number
  /** Index into BEARDS (0 = clean-shaven). */
  beard: number
}

export const SKIN_TONES = [
  0xf6d3b8, 0xeac0a0, 0xd9a07a, 0xc08060, 0xa86f4c, 0x8a5a3c, 0x6e4630, 0x4f3222,
] as const
export const HAIR_STYLES = [
  'bald',
  'buzz',
  'short',
  'side part',
  'messy',
  'mohawk',
  'bob',
  'ponytail',
  'long',
  'bun',
] as const
export const HAIR_COLORS = [
  0x161616, 0x2a1c12, 0x5a3b1e, 0x8a4a22, 0xc9a35a, 0xe6d3a3, 0x9a9a9a, 0xe8e8e8, 0x7a1f2b,
  0x2d4a8a,
] as const
export const EYE_COLORS = [0x3a2a1a, 0x5a3a1e, 0x2f6b3a, 0x3a6ea8, 0x6a7a86, 0x8a6a2a] as const
export const BEARDS = ['none', 'stubble', 'moustache', 'goatee', 'full'] as const

export const DEFAULT_APPEARANCE: Appearance = {
  body: 0,
  skin: 2,
  hair: 2,
  hairColor: 1,
  eyes: 0,
  beard: 0,
}

const FIELDS = [
  ['body', 2],
  ['skin', SKIN_TONES.length],
  ['hair', HAIR_STYLES.length],
  ['hairColor', HAIR_COLORS.length],
  ['eyes', EYE_COLORS.length],
  ['beard', BEARDS.length],
] as const

/** Packs an appearance into one number (4 bits per field) for the wire; out-of-range clamps. */
export function packAppearance(a: Appearance): number {
  let v = 0
  FIELDS.forEach(([key, n], i) => {
    const x = Math.max(0, Math.min(n - 1, Math.floor(Number(a[key]) || 0)))
    v |= x << (i * 4)
  })
  return v >>> 0
}

export function unpackAppearance(v: number): Appearance {
  const a = { ...DEFAULT_APPEARANCE }
  FIELDS.forEach(([key, n], i) => {
    a[key] = Math.min(n - 1, (v >>> (i * 4)) & 15)
  })
  return a
}

/** A random look (bots, NPCs, players who skip the creator). */
export function randomAppearance(random: () => number = Math.random): Appearance {
  const pick = (n: number) => Math.floor(random() * n)
  const body = pick(2)
  return {
    body,
    skin: pick(SKIN_TONES.length),
    hair: body === 1 ? 2 + pick(HAIR_STYLES.length - 2) : pick(6),
    hairColor: pick(HAIR_COLORS.length - 2),
    eyes: pick(EYE_COLORS.length),
    beard: body === 1 ? 0 : pick(BEARDS.length),
  }
}

/**
 * Clothes in survival (see gear.ts): head | body << 4 | legs << 8 | feet << 12 (u16 on the
 * wire). Body look 0 = the starting white tank top, legs look 0 = the starting grey joggers,
 * feet look 0 = barefoot. Existing HEAD_LOOKS/BODY_LOOKS keep their numbers; LEGS_LOOKS and
 * FEET_LOOKS are new:
 */
export const LEGS_LOOKS = { joggers: 0, jeans: 1, cargo: 2, camo: 3, work: 4, police: 5 } as const
export const FEET_LOOKS = { barefoot: 0, sneakers: 1, boots: 2, military: 3 } as const

import type { LootTable } from './items.ts'
import { type Poi, WORLD_HALF } from './types.ts'

/**
 * PvP by choice (ROADMAP 5.7). Haven is a hard safe zone; the woods are PvE (people can't hurt
 * each other); only on the army's ground around Site 7 — the Lawless ground — can anyone shoot
 * anyone, and what lies there is better. What you do to others shows: a Saint's pale armband, a
 * Raider's red one, and the Oathbreaker mark over whoever killed somebody they had a truce with.
 */

/** Where somebody stands: Haven (nobody hurts anybody), the woods (PvE), or Lawless ground. */
export type Ground = 'haven' | 'woods' | 'lawless'

/** The Lawless ground is this far round Site 7 (m), out to the world's edge. */
export const LAWLESS_RADIUS = 320
/** Haven's safety reaches this far past its clearing (m). */
export const HAVEN_MARGIN = 6

/** The place the Lawless ground is centred on (Site 7, the army's worst bunker). */
export function lawlessCentre(pois: readonly Poi[]): Poi | undefined {
  return pois.find((p) => p.key === 'site7')
}

/** What ground (x, z) is. */
export function groundAt(pois: readonly Poi[], at: { x: number; z: number }): Ground {
  for (const p of pois) {
    if (p.safe && Math.hypot(at.x - p.x, at.z - p.z) < p.r + HAVEN_MARGIN) return 'haven'
  }
  const c = lawlessCentre(pois)
  if (c && Math.hypot(at.x - c.x, at.z - c.z) < LAWLESS_RADIUS) return 'lawless'
  return 'woods'
}

/**
 * Points along the Lawless border inside the world, every `spacing` m, with the way out
 * (unit vector from the centre): where the warning signs and the red trees go.
 */
export function lawlessBorder(
  pois: readonly Poi[],
  spacing: number,
): { x: number; z: number; out: [number, number] }[] {
  const c = lawlessCentre(pois)
  if (!c) return []
  const n = Math.round((2 * Math.PI * LAWLESS_RADIUS) / spacing)
  const edge = WORLD_HALF - 60
  const out: { x: number; z: number; out: [number, number] }[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const x = c.x + dx * LAWLESS_RADIUS
    const z = c.z + dz * LAWLESS_RADIUS
    if (Math.abs(x) > edge || Math.abs(z) > edge) continue
    out.push({ x, z, out: [dx, dz] })
  }
  return out
}

/** What a loot spot holds on Lawless ground: one step up (a home's gun is a real one, etc.). */
const RICHER: Partial<Record<LootTable, LootTable>> = {
  homegun: 'gun',
  bedroom: 'police',
  kitchen: 'store',
  garage: 'gun',
  office: 'medical',
  gun: 'military',
  police: 'military',
  camp: 'hunting',
  hunting: 'military',
  store: 'medical',
}

/** The table a spot rolls from on `ground`: richer on Lawless ground, half the time. */
export function lootTableOn(table: LootTable, ground: Ground, roll: number): LootTable {
  if (ground !== 'lawless' || roll >= 0.5) return table
  return RICHER[table] ?? table
}

/** Chance a second thing lies beside the first (more on Lawless ground). */
export const secondFind = (ground: Ground): number => (ground === 'lawless' ? 0.6 : 0.35)

// --- Reputation ----------------------------------------------------------------------------

export type Standing = 'saint' | 'neutral' | 'raider'

/** At or below this you are a Raider; at or above SAINT_AT a Saint. */
export const RAIDER_AT = -3
export const SAINT_AT = 4
/** Reputation stays between these. */
export const REP_MIN = -12
export const REP_MAX = 12

/** What a reputation score reads as. */
export function standingOf(rep: number | undefined): Standing {
  const r = rep ?? 0
  if (r <= RAIDER_AT) return 'raider'
  if (r >= SAINT_AT) return 'saint'
  return 'neutral'
}

/** The armband colour others see (none for the neutral). Muted: chalk and old blood. */
export const ARMBAND: Record<Standing, number | null> = {
  saint: 0xc9c4b0,
  neutral: null,
  raider: 0x7a1d17,
}

/** The Oathbreaker mark lasts this long (s of play). */
export const OATH_SECONDS = 2 * 60 * 60

/** One person's standing as everyone is told (SurvivalShared.standing): flat triples. */
export interface StandingTag {
  id: number
  standing: Standing
  oathbreaker: boolean
}

const STANDING_CODE: Standing[] = ['neutral', 'saint', 'raider']

/** Packs tags for the wire: [id, standing (0 neutral, 1 saint, 2 raider), oathbreaker 0/1, …]. */
export function packStanding(tags: readonly StandingTag[]): number[] {
  return tags.flatMap((t) => [t.id, STANDING_CODE.indexOf(t.standing), t.oathbreaker ? 1 : 0])
}

export function unpackStanding(flat: readonly number[] | undefined): Map<number, StandingTag> {
  const out = new Map<number, StandingTag>()
  if (!flat) return out
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const id = flat[i] as number
    out.set(id, {
      id,
      standing: STANDING_CODE[flat[i + 1] as number] ?? 'neutral',
      oathbreaker: flat[i + 2] === 1,
    })
  }
  return out
}

/** The notice on stepping onto (true) or off (false) Lawless ground. */
export const LAWLESS_TEXT = {
  enter: 'Lawless ground — anyone can shoot you.',
  leave: 'You leave the lawless ground. Nobody here will raise a gun at you.',
} as const

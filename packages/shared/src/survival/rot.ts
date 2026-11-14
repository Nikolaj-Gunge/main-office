import { coverAt, surfaceAt } from './terrain.ts'
import { hash2, seeded } from './noise.ts'
import { Surface, type SurvivalDef } from './types.ts'

/**
 * "The Rot": what kind of night it is, the birds that give you away and the ground that cracks
 * underfoot. The server's tension director lives in apps/server/src/survival/rot.ts; this is
 * the part both sides need to agree on.
 */

/** What kind of night it is (rolled at dusk, seeded by the world and the night's number). */
export type RotMood = 'calm' | 'fog' | 'hunting' | 'choir'
export const ROT_MOODS: readonly RotMood[] = ['calm', 'fog', 'hunting', 'choir']

export interface MoodDef {
  /** Roaming dead in the woods around each of you (× the usual). */
  wanderers: number
  /** How far the dead see (× the weather's). */
  sight: number
  /** Share of the roaming dead that are runners / screamers instead (0: as usual). */
  runners: number
  screamers: number
  /** Seconds between the director's events (× the usual). */
  events: number
  /** Extra fog drawn on the clients (0–1, added to the weather's). */
  fog: number
  /** What the Haven radio says at dusk. */
  news: string
}

export const MOODS: Record<RotMood, MoodDef> = {
  calm: {
    wanderers: 0.75,
    sight: 1,
    runners: 0,
    screamers: 0,
    events: 1.5,
    fog: 0,
    news: "The radio at Haven is quiet tonight. Just the hiss. Don't trust it.",
  },
  fog: {
    wanderers: 1.45,
    sight: 0.7,
    runners: 0,
    screamers: 0,
    events: 1,
    fog: 0.6,
    news: "Static on the radio. Fog's coming down off the ridge, and something's moving in it.",
  },
  hunting: {
    wanderers: 1.1,
    sight: 1,
    runners: 0.4,
    screamers: 0,
    events: 0.85,
    fog: 0,
    news: "Static on the radio. Something's moving tonight. Fast ones. Stay off open ground.",
  },
  choir: {
    wanderers: 1,
    sight: 1,
    runners: 0,
    screamers: 0.25,
    events: 0.9,
    fog: 0,
    news: 'Static on the radio, and under it something like singing. The Choir is out tonight.',
  },
}

/** The mood of night number `night` in a world seeded `seed` (the same on every replay). */
export function moodFor(seed: number, night: number): RotMood {
  const r = seeded(seed * 31 + night * 7919 + 17)()
  // Calm nights are commonest; the rest share what's left.
  if (r < 0.4) return 'calm'
  if (r < 0.6) return 'fog'
  if (r < 0.8) return 'hunting'
  return 'choir'
}

/** The tension director's phase for one player (sent with their tension). */
export const RotPhase = { Build: 0, Peak: 1, Relax: 2 } as const
export type RotPhase = (typeof RotPhase)[keyof typeof RotPhase]

// --- Birds --------------------------------------------------------------------------------

/** Birds take off when a person comes this close (m), or a gun goes off this close. */
export const BIRDS_NEAR = 12
export const BIRDS_SHOT = 60
/** Seconds before a flock that took off is back on the ground. */
export const BIRDS_SETTLE = 240
/** How far the flap and the cawing carry (m): to people, and to the dead. */
export const BIRDS_HEARD = 400
export const BIRDS_DRAW = 45

export interface Flock {
  x: number
  z: number
  /** How many birds. */
  n: number
}

const FLOCK_CELL = 110

/** Every flock in the woods and fields (the same on both sides, from the map). */
export function flocksOf(def: SurvivalDef): Flock[] {
  const out: Flock[] = []
  const seed = def.seed + 4242
  for (let cx = -13; cx <= 13; cx++) {
    for (let cz = -13; cz <= 13; cz++) {
      if (hash2(cx, cz, seed) > 0.32) continue
      const x = (cx + 0.15 + hash2(cx, cz, seed + 1) * 0.7) * FLOCK_CELL
      const z = (cz + 0.15 + hash2(cx, cz, seed + 2) * 0.7) * FLOCK_CELL
      const t = def.terrain
      const open = surfaceAt(t, x, z) === Surface.Meadow
      if (!open && coverAt(t, x, z) < 0.35) continue
      if (def.pois.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 15)) continue
      if (def.lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 4)) continue
      out.push({ x, z, n: 5 + Math.floor(hash2(cx, cz, seed + 3) * 5) })
    }
  }
  return out
}

// --- Underfoot ----------------------------------------------------------------------------

export type Crunch = 'glass' | 'branch'

/** How far a step on glass or a dry branch carries (m): walking, sprinting, crouched. */
export const CRUNCH_NOISE = { walk: 20, sprint: 26, crouch: 6 }

const PLACES_WITH_GLASS = new Set(['town', 'checkpoint', 'crash', 'gas', 'farm', 'house'])

/**
 * Broken glass (in and around the towns and houses) or dry branches (in the thick woods) under
 * (x, z), or null. Small patches on a hashed grid: the same for the client and the server.
 */
export function crunchAt(def: SurvivalDef, x: number, z: number): Crunch | null {
  const seed = def.seed + 911
  for (const p of def.pois) {
    if (!PLACES_WITH_GLASS.has(p.kind) || Math.hypot(p.x - x, p.z - z) > p.r) continue
    const cx = Math.floor(x / 5)
    const cz = Math.floor(z / 5)
    if (hash2(cx, cz, seed) > 0.12) return null
    const gx = (cx + 0.3 + hash2(cx, cz, seed + 1) * 0.4) * 5
    const gz = (cz + 0.3 + hash2(cx, cz, seed + 2) * 0.4) * 5
    return Math.hypot(gx - x, gz - z) < 1.1 ? 'glass' : null
  }
  if (coverAt(def.terrain, x, z) < 0.45) return null
  const cx = Math.floor(x / 7)
  const cz = Math.floor(z / 7)
  if (hash2(cx, cz, seed + 3) > 0.07) return null
  const gx = (cx + 0.3 + hash2(cx, cz, seed + 4) * 0.4) * 7
  const gz = (cz + 0.3 + hash2(cx, cz, seed + 5) * 0.4) * 7
  return Math.hypot(gx - x, gz - z) < 1.3 ? 'branch' : null
}

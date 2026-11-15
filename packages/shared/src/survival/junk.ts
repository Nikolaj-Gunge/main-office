import type { Site } from './kit.ts'
import type { Poi } from './types.ts'

/**
 * Kickable junk (research 2.2): tin cans, buckets, bottles and the odd tyre lying about Haven and
 * outside people's homes. Walk into one and it skitters off; swing at it and it flies. It clatters,
 * and the dead hear it. Haven has a barrel to kick cans into, with a tally chalked beside it.
 *
 * The server decides where each lands (junk.ts there) and tells those nearby (a `junk` social
 * event: the client draws the tumble); everybody gets where they all lie in the world's shared
 * state once a second (packJunk), so nothing drifts apart.
 */

export type JunkKind = 'can' | 'bucket' | 'bottle' | 'tyre'

export interface JunkSpot {
  /** Index into junkSpots (stable for a map). */
  i: number
  kind: JunkKind
  /** Where it lies when nobody has kicked it. */
  x: number
  y: number
  z: number
}

/** Size of each (m): radius on the ground, height standing; and how far a kick sends it (×). */
export const JUNK_LOOKS: Record<JunkKind, { r: number; h: number; carry: number }> = {
  can: { r: 0.05, h: 0.12, carry: 1 },
  bottle: { r: 0.04, h: 0.26, carry: 0.9 },
  bucket: { r: 0.15, h: 0.3, carry: 0.6 },
  tyre: { r: 0.32, h: 0.2, carry: 0.45 },
}

/** Walking into it nudges it this far (m) at a run; less at a walk. */
export const KICK_WALK = 2.4
/** A swing (knife, fists, any melee) sends it this far (m). */
export const KICK_SWING = 7
/** You touch it within this (m, centre to centre, flat). */
export const KICK_REACH = 0.55
/** A swing reaches it within this (m). */
export const SWING_REACH = 1.7
/** The dead within this (m) hear it clatter. */
export const JUNK_NOISE = 22

/** Haven's barrel (Haven-local x, z): a burnt-out drum with the top cut off. */
export const HOOP_LOCAL: readonly [number, number] = [17.5, -13.5]
/** A can passing this close (m) over the barrel's middle, coming down, drops in. */
export const HOOP_MOUTH = 0.42
/** How tall the barrel is (m). */
export const HOOP_HEIGHT = 0.9

/** Seconds a kick takes to land: short skitters are quick, long kicks arc. */
export function flightSeconds(distance: number): number {
  return 0.25 + Math.min(1, distance * 0.08)
}

/** Haven's barrel in world space, or null on maps without Haven. */
export function hoopAt(pois: readonly Poi[]): { x: number; y: number; z: number } | null {
  const haven = pois.find((p) => p.key === 'haven')
  if (!haven) return null
  return { x: haven.x + HOOP_LOCAL[0], y: haven.y, z: haven.z + HOOP_LOCAL[1] }
}

/** Haven's junk (local x, z): cans near the barrel to kick at it, more round the square. */
const HAVEN_JUNK: readonly [JunkKind, number, number][] = [
  ['can', 13.6, -11.2],
  ['can', 14.2, -12.3],
  ['can', 13.2, -10.2],
  ['can', 14.6, -10.6],
  ['bottle', 12.9, -11.9],
  ['bucket', -7.8, -8.2],
  ['can', -4.6, -7.6],
  ['bottle', 3.6, 4.6],
  ['can', -3.4, 4.2],
  ['tyre', -8.6, 19.8],
  ['bucket', 5.2, 19.6],
]

/** Places people lived: a couple of things lie outside each. */
const HOMES = new Set<Poi['kind']>([
  'start',
  'house',
  'cabin',
  'trailers',
  'camper',
  'farm',
  'shed',
])
const HOME_KINDS: readonly JunkKind[] = ['can', 'bucket', 'bottle', 'can', 'tyre']

/** A number 0–1 from a string and a salt (the same everywhere). */
function hashOf(text: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** Every bit of junk in the world, where it lies to begin with (the same on server and client). */
export function junkSpots(pois: readonly Poi[]): JunkSpot[] {
  const out: JunkSpot[] = []
  const add = (kind: JunkKind, x: number, y: number, z: number) =>
    out.push({ i: out.length, kind, x, y, z })
  const haven = pois.find((p) => p.key === 'haven')
  if (haven) for (const [kind, x, z] of HAVEN_JUNK) add(kind, haven.x + x, haven.y, haven.z + z)
  for (const p of pois) {
    if (!HOMES.has(p.kind)) continue
    // Two things at the edge of the yard, on its flat ground (clear of most walls).
    for (let k = 0; k < 2; k++) {
      const angle = hashOf(p.key, k) * Math.PI * 2
      const r = Math.max(3, p.r * (0.62 + 0.2 * hashOf(p.key, k + 7)))
      const kind = HOME_KINDS[Math.floor(hashOf(p.key, k + 3) * HOME_KINDS.length)] ?? 'can'
      add(kind, p.x + Math.cos(angle) * r, p.y, p.z + Math.sin(angle) * r)
    }
  }
  return out
}

/**
 * Does a kick from `a` to `b` drop in the barrel at `hoop`? Its path has to pass over the
 * barrel's middle in the second half of the flight (coming down), not just roll past its foot.
 */
export function throughHoop(
  a: { x: number; z: number },
  b: { x: number; z: number },
  hoop: { x: number; z: number },
): boolean {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1) return false
  const t = Math.max(0, Math.min(1, ((hoop.x - a.x) * dx + (hoop.z - a.z) * dz) / len2))
  if (t < 0.45) return false
  return Math.hypot(a.x + dx * t - hoop.x, a.z + dz * t - hoop.z) < HOOP_MOUTH
}

/** Where moved junk lies, packed for the shared state: index, x×10, z×10, … */
export function packJunk(moved: readonly { i: number; x: number; z: number }[]): number[] {
  const out: number[] = []
  for (const m of moved) out.push(m.i, Math.round(m.x * 10), Math.round(m.z * 10))
  return out
}

export function unpackJunk(
  packed: readonly number[] | undefined,
): Map<number, { x: number; z: number }> {
  const out = new Map<number, { x: number; z: number }>()
  if (!packed) return out
  for (let k = 0; k + 2 < packed.length; k += 3) {
    out.set(packed[k] as number, {
      x: (packed[k + 1] as number) / 10,
      z: (packed[k + 2] as number) / 10,
    })
  }
  return out
}

/** The chalkboard beside the barrel, facing west (Haven-local x, z; the client chalks the tally). */
export const HOOP_BOARD: readonly [number, number] = [18.7, -12.9]

/**
 * Haven's barrel hoop: an open-topped drum (solid, so it stops what hits its side) and a
 * chalkboard on a stake beside it, facing the square.
 */
export function hoopBarrel(s: Site): void {
  const [x, z] = HOOP_LOCAL
  s.block(x, 0, z, 0.62, HOOP_HEIGHT, 0.62, 'rust')
  for (const h of [0.3, 0.62]) s.deco(x, h, z, 0.66, 0.04, 0.66, 'metal')
  // The cut top: a dark inside, a ragged rim.
  s.deco(x, HOOP_HEIGHT, z, 0.5, 0.012, 0.5, 'asphalt')
  s.deco(x - 0.29, HOOP_HEIGHT, z, 0.04, 0.05, 0.62, 'metal')
  s.deco(x + 0.29, HOOP_HEIGHT, z, 0.04, 0.05, 0.62, 'metal')
  const [bx, bz] = HOOP_BOARD
  s.block(bx, 0, bz, 0.08, 1.3, 0.08, 'log')
  s.deco(bx - 0.05, 1.0, bz, 0.04, 0.44, 0.62, 'asphalt')
  s.deco(bx - 0.05, 1.44, bz, 0.06, 0.04, 0.66, 'wood')
}

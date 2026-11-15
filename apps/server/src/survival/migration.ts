import type { Poi } from '@office-fps/shared'

/**
 * Fog lets the hordes move (ROADMAP 6.9). When a heavy fog comes down a crowd of the dead sets
 * off across the county from one place to another, the long way round Haven and the lakes. Out
 * where nobody is it's only a point walking along its route; near people it's real walkers
 * (weather-world.ts). These are the pure bits: the route, and where along it the crowd is.
 */

export interface Spot {
  x: number
  z: number
}

/** Somewhere to give a wide berth: Haven, a lake. */
export interface Keepout extends Spot {
  r: number
}

/** How far a migration walks at the least and the most (m, straight line, end to end). */
export const MIGRATION_MIN = 900
export const MIGRATION_MAX = 1900
/** How fast the crowd drifts along (m/s): a shuffle. */
export const MIGRATION_SPEED = 1.1
/** How many of the dead walk in one. */
export const MIGRATION_SIZE = { min: 8, max: 15 }
/** Never nearer than this to a safe place's edge (m). */
const SAFE_BERTH = 160
/** The world's edge, kept clear of (m from the centre, each way). */
const RIM = 1380

/** Where the route from a to b passes nearest to c: the point, and how far along (0–1). */
function closest(a: Spot, b: Spot, c: Spot): { t: number; d: number } {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / len2))
  return { t, d: Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) }
}

/**
 * The way from `from` to `to` round every keep-out: straight where it can, and where a leg runs
 * too close to one, out round its side (the side the leg already passes on).
 */
export function detour(from: Spot, to: Spot, keepouts: readonly Keepout[], depth = 0): Spot[] {
  if (depth > 6) return [from, to]
  let worst: { k: Keepout; t: number; d: number } | null = null
  for (const k of keepouts) {
    const c = closest(from, to, k)
    if (c.d < k.r && (!worst || c.d - k.r < worst.d - worst.k.r)) worst = { k, ...c }
  }
  if (!worst) return [from, to]
  const { k, t } = worst
  // Out from the keep-out's centre, through the nearest point of the leg (or square to the leg).
  const px = from.x + (to.x - from.x) * t - k.x
  const pz = from.z + (to.z - from.z) * t - k.z
  let n = Math.hypot(px, pz)
  let ox = px
  let oz = pz
  if (n < 1) {
    ox = -(to.z - from.z)
    oz = to.x - from.x
    n = Math.hypot(ox, oz) || 1
  }
  const via = {
    x: Math.max(-RIM, Math.min(RIM, k.x + (ox / n) * k.r * 1.25)),
    z: Math.max(-RIM, Math.min(RIM, k.z + (oz / n) * k.r * 1.25)),
  }
  const head = detour(from, via, keepouts, depth + 1)
  const tail = detour(via, to, keepouts, depth + 1)
  return [...head, ...tail.slice(1)]
}

/** What a route keeps clear of: safe places (by far) and lakes. */
export function keepoutsOf(pois: readonly Poi[], lakes: readonly Keepout[]): Keepout[] {
  return [
    ...pois.filter((p) => p.safe).map((p) => ({ x: p.x, z: p.z, r: p.r + SAFE_BERTH })),
    ...lakes.map((l) => ({ x: l.x, z: l.z, r: l.r + 30 })),
  ]
}

/**
 * A migration: from one known place to another a long way off, the way round. Null when no
 * pair will do (a tiny test world).
 */
export function planMigration(
  pois: readonly Poi[],
  lakes: readonly Keepout[],
  random: () => number,
): { from: Poi; to: Poi; route: Spot[] } | null {
  const keep = keepoutsOf(pois, lakes)
  // Real places, out of everyone's way of a safe place.
  const ends = pois.filter(
    (p) =>
      !p.safe &&
      !p.hidden &&
      p.danger > 0 &&
      keep.every((k) => Math.hypot(p.x - k.x, p.z - k.z) > k.r),
  )
  for (let n = 0; n < 40 && ends.length > 1; n++) {
    const from = ends[Math.floor(random() * ends.length)] as Poi
    const to = ends[Math.floor(random() * ends.length)] as Poi
    const d = Math.hypot(to.x - from.x, to.z - from.z)
    if (d < MIGRATION_MIN || d > MIGRATION_MAX) continue
    return { from, to, route: detour(from, to, keep) }
  }
  return null
}

/** How long a route is (m). */
export function routeLength(route: readonly Spot[]): number {
  let len = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Spot
    const b = route[i] as Spot
    len += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return len
}

/** The point `metres` along a route (its end, past the end), and which way it heads there. */
export function alongRoute(route: readonly Spot[], metres: number): Spot & { heading: number } {
  let left = Math.max(0, metres)
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Spot
    const b = route[i] as Spot
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const heading = Math.atan2(b.z - a.z, b.x - a.x)
    if (left <= len || i === route.length - 1) {
      const t = len > 0 ? Math.min(1, left / len) : 1
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading }
    }
    left -= len
  }
  const only = route[0] ?? { x: 0, z: 0 }
  return { x: only.x, z: only.z, heading: 0 }
}

/**
 * Where people hear the crowd is (the radio, the compass): somewhere within about 80 m of it,
 * the same guess for a minute at a time so the mark doesn't jitter.
 */
export function rumourOf(head: Spot, minute: number, seed: number): Spot {
  const h = Math.sin((minute + 1) * 12.9898 + seed * 78.233) * 43758.5453
  const a = (h - Math.floor(h)) * Math.PI * 2
  const g = Math.sin((minute + 7) * 39.3468 + seed * 11.135) * 24634.6345
  const r = 30 + (g - Math.floor(g)) * 50
  return { x: Math.round(head.x + Math.cos(a) * r), z: Math.round(head.z + Math.sin(a) * r) }
}

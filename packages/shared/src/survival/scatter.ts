import { seeded } from './noise.ts'
import type { RoadPlan } from './terrain.ts'
import { type PoiKind, WORLD_HALF } from './types.ts'

/**
 * The small places scattered through the woods between the big ones — lone houses and campers
 * near the roads, sheds, treehouses and hunting stands deep in the trees — so that wherever you
 * walk you come across somebody's last stand. Picked once from the world's seed (the same on
 * client and server), each as far as it can be from every place already there.
 */

export type ScatterKind = Extract<PoiKind, 'house' | 'camper' | 'shed' | 'treehouse' | 'stand'>

export interface Scattered {
  kind: ScatterKind
  x: number
  z: number
  r: number
  /** Quarter turns clockwise (houses and campers face their road). */
  turn: number
  wooded: boolean
}

interface Kind {
  kind: ScatterKind
  count: number
  r: number
  wooded: boolean
  /** How far from the middle of the nearest road (m). */
  road: [min: number, max: number]
}

/** In this order: the fussier kinds (near a road) choose first. */
const KINDS: Kind[] = [
  { kind: 'house', count: 26, r: 15, wooded: false, road: [27, 70] },
  { kind: 'camper', count: 10, r: 11, wooded: false, road: [19, 45] },
  { kind: 'treehouse', count: 22, r: 18, wooded: true, road: [60, Number.POSITIVE_INFINITY] },
  { kind: 'stand', count: 16, r: 10, wooded: true, road: [45, Number.POSITIVE_INFINITY] },
  { kind: 'shed', count: 16, r: 9, wooded: true, road: [30, Number.POSITIVE_INFINITY] },
]

/** Room left between a scattered place's clearing and any other's. */
const GAP = 45
/** Haven keeps its quiet: nothing within this much of its clearing. */
const SAFE_GAP = 150
/** Away from the steep rim round the world. */
const EDGE = WORLD_HALF - 220
/** Candidates tried for each place; the one furthest from everything wins. */
const TRIES = 40

const sq = (v: number) => v * v

/** Nearest point on any road to (x, z), and the squared distance to it. */
function nearestRoad(
  roads: readonly RoadPlan[],
  x: number,
  z: number,
): { x: number; z: number; d2: number } {
  let best = { x, z, d2: Number.POSITIVE_INFINITY }
  for (const road of roads) {
    for (let i = 0; i + 1 < road.points.length; i++) {
      const [ax, az] = road.points[i] as [number, number]
      const [bx, bz] = road.points[i + 1] as [number, number]
      const vx = bx - ax
      const vz = bz - az
      const len2 = vx * vx + vz * vz
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2)) : 0
      const px = ax + vx * t
      const pz = az + vz * t
      const d2 = sq(x - px) + sq(z - pz)
      if (d2 < best.d2) best = { x: px, z: pz, d2 }
    }
  }
  return best
}

/** The quarter turn that points a place's front (its local +z) towards (dx, dz). */
function facing(dx: number, dz: number): number {
  if (Math.abs(dz) >= Math.abs(dx)) return dz >= 0 ? 0 : 2
  return dx >= 0 ? 3 : 1
}

/**
 * Picks the scattered places: clear of every planned place (`taken`, Haven by far more), of the
 * lakes and of each other, at the right distance from the roads. Products and sqrt only (no hypot
 * or pow), so every JS engine picks the same spots.
 */
export function scatterPlaces(
  seed: number,
  taken: readonly { x: number; z: number; r: number; safe?: boolean }[],
  roads: readonly RoadPlan[],
  lakes: readonly { x: number; z: number; r: number }[],
): Scattered[] {
  const random = seeded(seed * 7 + 13)
  const out: Scattered[] = []
  const all: { x: number; z: number; r: number; safe?: boolean }[] = [...taken]
  for (const k of KINDS) {
    for (let n = 0; n < k.count; n++) {
      let best: Scattered | null = null
      let bestRoom = -1
      for (let tries = 0, valid = 0; tries < TRIES * 50 && valid < TRIES; tries++) {
        const x = (random() * 2 - 1) * EDGE
        const z = (random() * 2 - 1) * EDGE
        const turnRoll = random()
        const road = nearestRoad(roads, x, z)
        const roadD = Math.sqrt(road.d2)
        if (roadD < k.road[0] || roadD > k.road[1]) continue
        if (lakes.some((l) => sq(l.x - x) + sq(l.z - z) < sq(l.r + k.r + 40))) continue
        // How much room it has: the smallest gap to anything already there.
        let room = Number.POSITIVE_INFINITY
        for (const p of all) {
          const gap = Math.sqrt(sq(p.x - x) + sq(p.z - z)) - p.r - k.r
          room = Math.min(room, gap - (p.safe ? SAFE_GAP : GAP))
        }
        if (room < 0) continue
        valid++
        if (room <= bestRoom) continue
        bestRoom = room
        const nearRoad = k.road[1] < Number.POSITIVE_INFINITY
        best = {
          kind: k.kind,
          x: Math.round(x),
          z: Math.round(z),
          r: k.r,
          turn: nearRoad ? facing(road.x - x, road.z - z) : Math.floor(turnRoll * 4),
          wooded: k.wooded,
        }
      }
      if (!best) break
      out.push(best)
      all.push(best)
    }
  }
  return out
}

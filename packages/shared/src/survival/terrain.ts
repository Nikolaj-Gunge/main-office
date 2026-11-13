import { hash2, seeded, smoothstep, valueNoise } from './noise.ts'
import {
  CELL,
  CHUNK,
  GRID,
  type Lake,
  type Poi,
  type Road,
  Surface,
  type Terrain,
  WORLD_HALF,
} from './types.ts'

const N = GRID + 1
const index = (xi: number, zi: number) => xi * N + zi
const clampGrid = (v: number) => Math.max(0, Math.min(GRID, v))

/** Rolling hills, with a steep rim around the edge of the world that nobody climbs. */
function rawHeight(x: number, z: number, seed: number): number {
  const hills =
    16 * valueNoise(x / 460, z / 460, seed) +
    6 * valueNoise(x / 170, z / 170, seed + 1) +
    1.5 * valueNoise(x / 48, z / 48, seed + 2)
  const edge = Math.max(Math.abs(x), Math.abs(z))
  return hills + smoothstep(WORLD_HALF - 150, WORLD_HALF - 30, edge) * 120
}

/** Ground height at a point, on exactly the triangles the physics heightfield uses. */
export function heightAt(t: Terrain, x: number, z: number): number {
  const gx = Math.max(0, Math.min(GRID - 1e-6, (x + WORLD_HALF) / CELL))
  const gz = Math.max(0, Math.min(GRID - 1e-6, (z + WORLD_HALF) / CELL))
  const xi = Math.floor(gx)
  const zi = Math.floor(gz)
  const fx = gx - xi
  const fz = gz - zi
  const h = t.heights
  const h10 = h[index(xi + 1, zi)] as number
  const h01 = h[index(xi, zi + 1)] as number
  // Each cell is split along the diagonal from (x+1, z) to (x, z+1), as Rapier does.
  if (fx + fz < 1) {
    const h00 = h[index(xi, zi)] as number
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz
  }
  const h11 = h[index(xi + 1, zi + 1)] as number
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
}

/** Forest cover (0–1) at a point: the nearest grid vertex's. */
export function coverAt(t: Terrain, x: number, z: number): number {
  const xi = clampGrid(Math.round((x + WORLD_HALF) / CELL))
  const zi = clampGrid(Math.round((z + WORLD_HALF) / CELL))
  return (t.cover[index(xi, zi)] as number) / 255
}

export function surfaceAt(t: Terrain, x: number, z: number): number {
  const xi = clampGrid(Math.round((x + WORLD_HALF) / CELL))
  const zi = clampGrid(Math.round((z + WORLD_HALF) / CELL))
  return t.surface[index(xi, zi)] as number
}

/** Calls `visit` for every grid vertex within `radius` of (x, z), with its distance. */
function around(
  x: number,
  z: number,
  radius: number,
  visit: (i: number, distance: number, vx: number, vz: number) => void,
): void {
  const x0 = clampGrid(Math.floor((x - radius + WORLD_HALF) / CELL))
  const x1 = clampGrid(Math.ceil((x + radius + WORLD_HALF) / CELL))
  const z0 = clampGrid(Math.floor((z - radius + WORLD_HALF) / CELL))
  const z1 = clampGrid(Math.ceil((z + radius + WORLD_HALF) / CELL))
  for (let xi = x0; xi <= x1; xi++) {
    for (let zi = z0; zi <= z1; zi++) {
      const vx = xi * CELL - WORLD_HALF
      const vz = zi * CELL - WORLD_HALF
      const d = Math.hypot(vx - x, vz - z)
      if (d <= radius) visit(index(xi, zi), d, vx, vz)
    }
  }
}

/** What a place asks of the ground before it is built on. */
export interface PoiSite {
  x: number
  z: number
  r: number
  /** Raise (or sink) the place this far from the natural ground: hills for bunkers and towers. */
  lift?: number
  /** How far the slope down to the natural ground runs (m). */
  skirt?: number
  /** Leave the trees standing right up to the buildings (hidden cabins). */
  wooded?: boolean
}

export interface RoadPlan {
  kind: 'asphalt' | 'dirt'
  width: number
  /** Corners of the road (x, z); it runs straight between them. */
  points: [number, number][]
}

/**
 * Builds the ground: hills, then flat clearings for places, then roads cut level through the
 * hills between them, then lakes. Returns the terrain and each place's ground height.
 */
export function buildTerrain(
  seed: number,
  sites: readonly PoiSite[],
  roadPlans: readonly RoadPlan[],
  lakePlans: readonly { x: number; z: number; r: number }[],
): { terrain: Terrain; heights: number[]; roads: Road[]; lakes: Lake[] } {
  const heights = new Float32Array(N * N)
  const cover = new Uint8Array(N * N)
  const surface = new Uint8Array(N * N)
  for (let xi = 0; xi < N; xi++) {
    for (let zi = 0; zi < N; zi++) {
      const x = xi * CELL - WORLD_HALF
      const z = zi * CELL - WORLD_HALF
      heights[index(xi, zi)] = rawHeight(x, z, seed)
      // Mostly thick forest, with meadows where the noise dips.
      const glade = valueNoise(x / 95, z / 95, seed + 5) + 0.35 * valueNoise(x / 31, z / 31, seed + 6)
      const c = smoothstep(-0.62, -0.25, glade)
      cover[index(xi, zi)] = Math.round(c * 255)
      surface[index(xi, zi)] = c < 0.35 ? Surface.Meadow : Surface.Forest
    }
  }
  const terrain: Terrain = { heights, cover, surface }

  // Places: flat ground, a slope down (or up) to the hills around, no trees.
  const flatten = (site: PoiSite, y: number, skirt: number, clear: boolean) => {
    around(site.x, site.z, site.r + skirt, (i, d) => {
      const w = smoothstep(site.r + skirt, site.r, d)
      heights[i] = (heights[i] as number) + (y - (heights[i] as number)) * w
      if (!clear) return
      const keep = site.wooded ? smoothstep(site.r * 0.55, site.r + 6, d) : smoothstep(site.r + 2, site.r + 20, d)
      cover[i] = Math.min(cover[i] as number, Math.round(keep * 255))
      if (d < site.r + 3) surface[i] = Surface.Dirt
    })
  }
  const siteHeights = sites.map((site) => {
    const y = heightAt(terrain, site.x, site.z) + (site.lift ?? 0)
    flatten(site, y, site.skirt ?? 26, true)
    return y
  })

  // Roads: follow the ground, smoothed along their length, level across their width.
  const nearest = new Float32Array(N * N).fill(Number.POSITIVE_INFINITY)
  const roadHeight = new Float32Array(N * N)
  const roadHalf = new Float32Array(N * N)
  const roads: Road[] = roadPlans.map((plan) => {
    const line: { x: number; y: number; z: number }[] = []
    for (let p = 0; p + 1 < plan.points.length; p++) {
      const [ax, az] = plan.points[p] as [number, number]
      const [bx, bz] = plan.points[p + 1] as [number, number]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2))
      for (let s = p === 0 ? 0 : 1; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps
        const z = az + ((bz - az) * s) / steps
        line.push({ x, y: heightAt(terrain, x, z), z })
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const ys = line.map((p) => p.y)
      for (let i = 0; i < line.length; i++) {
        let sum = 0
        let count = 0
        for (let k = Math.max(0, i - 9); k <= Math.min(line.length - 1, i + 9); k++) {
          sum += ys[k] as number
          count++
        }
        ;(line[i] as { y: number }).y = sum / count
      }
    }
    const half = plan.width / 2 + 2.5
    for (const p of line) {
      around(p.x, p.z, half + 16, (i, d) => {
        if (d >= (nearest[i] as number)) return
        nearest[i] = d
        roadHeight[i] = p.y
        roadHalf[i] = half
      })
    }
    return { kind: plan.kind, width: plan.width, line }
  })
  for (let i = 0; i < N * N; i++) {
    const d = nearest[i] as number
    if (!Number.isFinite(d)) continue
    const half = roadHalf[i] as number
    const w = smoothstep(half + 14, half, d)
    heights[i] = (heights[i] as number) + ((roadHeight[i] as number) - (heights[i] as number)) * w
    const keep = smoothstep(half + 1, half + 13, d)
    cover[i] = Math.min(cover[i] as number, Math.round(keep * 255))
    if (d < half) surface[i] = Surface.Dirt
  }
  // The road follows the ground it levelled.
  for (const road of roads) for (const p of road.line) p.y = heightAt(terrain, p.x, p.z)
  // A road may have cut into a place's edge: the place itself stays exactly flat.
  sites.forEach((site, i) => {
    flatten(site, siteHeights[i] as number, 8, false)
  })
  for (const road of roads) for (const p of road.line) p.y = heightAt(terrain, p.x, p.z)

  // Lakes: a shallow bowl with a sandy shore; the water stands a little below the old ground.
  const lakes = lakePlans.map((plan) => {
    let low = Number.POSITIVE_INFINITY
    around(plan.x, plan.z, plan.r, (i) => {
      low = Math.min(low, heights[i] as number)
    })
    const y = low - 0.3
    around(plan.x, plan.z, plan.r + 34, (i, d) => {
      const w = smoothstep(plan.r + 30, plan.r - 6, d)
      const bed = y - 0.2 - 1.1 * smoothstep(plan.r, plan.r * 0.4, d)
      heights[i] = (heights[i] as number) + (bed - (heights[i] as number)) * w
      cover[i] = Math.min(cover[i] as number, Math.round(smoothstep(plan.r + 6, plan.r + 26, d) * 255))
      if (d < plan.r + 7) surface[i] = Surface.Sand
    })
    return { ...plan, y }
  })

  return { terrain, heights: siteHeights, roads, lakes }
}

// --- The forest: trees, rocks and undergrowth, chunk by chunk ---------------------------------

export const PropKind = {
  Pine: 0,
  DeadTree: 1,
  Birch: 2,
  Rock: 3,
  Stump: 4,
  Bush: 5,
  Fern: 6,
  Log: 7,
} as const
export type PropKind = (typeof PropKind)[keyof typeof PropKind]

export interface Prop {
  kind: PropKind
  x: number
  y: number
  z: number
  /** Size relative to normal (about 0.7–1.5). */
  scale: number
  /** Turn, 0–1 of a full circle. */
  turn: number
}

/** Trees per chunk side: one candidate spot every CHUNK / TREE_GRID metres. */
const TREE_GRID = 10
const UNDERGROWTH_GRID = 13

/**
 * Everything that grows or lies in one chunk of forest, the same every time it is asked for.
 * `cx`, `cz` count chunks from the world's north-west corner.
 */
export function chunkProps(t: Terrain, seed: number, cx: number, cz: number): Prop[] {
  const out: Prop[] = []
  const random = seeded(Math.floor(hash2(cx, cz, seed) * 0xffffffff))
  const x0 = cx * CHUNK - WORLD_HALF
  const z0 = cz * CHUNK - WORLD_HALF
  const place = (grid: number, pick: (cover: number, roll: number) => PropKind | null) => {
    const step = CHUNK / grid
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        // Always draw the same number of random values per spot, kept or not.
        const x = x0 + (i + 0.1 + random() * 0.8) * step
        const z = z0 + (j + 0.1 + random() * 0.8) * step
        const roll = random()
        const scale = 0.75 + random() * 0.7
        const turn = random()
        const kind = pick(coverAt(t, x, z), roll)
        if (kind === null) continue
        out.push({ kind, x, y: heightAt(t, x, z), z, scale, turn })
      }
    }
  }
  place(TREE_GRID, (cover, roll) => {
    if (roll > cover * 0.9) return roll > 0.985 && cover > 0.05 ? PropKind.Rock : null
    const kind = roll / Math.max(cover, 1e-3)
    if (kind < 0.7) return PropKind.Pine
    if (kind < 0.8) return PropKind.DeadTree
    if (kind < 0.9) return PropKind.Birch
    if (kind < 0.95) return PropKind.Rock
    return PropKind.Stump
  })
  place(UNDERGROWTH_GRID, (cover, roll) => {
    if (cover < 0.04) return null
    if (roll < 0.2 * cover) return PropKind.Bush
    if (roll < 0.5 * cover) return PropKind.Fern
    if (roll > 0.985) return PropKind.Log
    return null
  })
  return out
}

/**
 * The solid part of a prop: an upright cylinder (radius, height) standing at its position, or
 * null for things you walk through (bushes, ferns, logs).
 */
export function propSolid(p: Prop): { radius: number; height: number } | null {
  switch (p.kind) {
    case PropKind.Pine:
      return { radius: 0.3 * p.scale, height: 7 }
    case PropKind.DeadTree:
      return { radius: 0.24 * p.scale, height: 6 }
    case PropKind.Birch:
      return { radius: 0.16 * p.scale, height: 6 }
    case PropKind.Rock:
      return { radius: 0.75 * p.scale, height: 1.1 * p.scale }
    case PropKind.Stump:
      return { radius: 0.34 * p.scale, height: 0.45 }
    default:
      return null
  }
}

/** The chunk a point is in (clamped to the world). */
export function chunkOf(x: number, z: number): [number, number] {
  const max = GRID / (CHUNK / CELL) - 1
  return [
    Math.max(0, Math.min(max, Math.floor((x + WORLD_HALF) / CHUNK))),
    Math.max(0, Math.min(max, Math.floor((z + WORLD_HALF) / CHUNK))),
  ]
}

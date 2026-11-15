import {
  CHUNK,
  chunkProps,
  FOLIAGE_MATERIALS,
  heightAt,
  type MapBox,
  type MapDef,
  propSolid,
  type SurvivalDef,
  WORLD_HALF,
  WORLD_SIZE,
} from '@office-fps/shared'
import type { Point } from '../items.ts'

/**
 * Finding a way for the dead across Deadwood (see horde.ts). The world is far too big for one
 * walking grid, so it is cut into the forest's 64 m chunks and each chunk gets a fine grid
 * (half-metre cells) the first time anybody needs it — only chunks with buildings, fences or
 * cars in them get one at all; the open forest is all free ground. Walls and fences come from
 * the map's own boxes (no physics queries), so a grid costs a millisecond or two to build.
 *
 * Doorways are gaps in the walls, so a path into a house goes through its door by itself.
 * Barricades aren't map boxes: a boarded-up door is open ground here, and the dead walk up to
 * it and batter it down (horde.ts) like before.
 *
 * Trees are left out of the grid (they would make nearly every straight line "blocked" in the
 * woods): `treesNear` hands them to the steering, which just sidesteps them.
 */

/** Size of a grid cell (m): fine enough that the narrowest door has a free cell in it. */
export const NAV_CELL = 0.5
const SIDE = CHUNK / NAV_CELL
const CELLS = WORLD_SIZE / NAV_CELL
const CHUNKS = WORLD_SIZE / CHUNK
/** A cell nobody fits through. */
const BLOCKED = 1
/** A cell close to a wall: fine to walk, but paths keep off them where they can. */
const NEAR = 2
/** Room kept round a box: its centre in that is blocked (the body's radius is 0.35). */
const SOLID_PAD = 0.1
const NEAR_PAD = 0.55
/** Heights above the ground a body fills (below the lowest: a step it walks up). */
const BODY = [0.5, 1.05, 1.6]
/** How far a path may go from where it starts (m). */
export const PLAN_RANGE = 60
const WINDOW = Math.ceil((PLAN_RANGE * 2) / NAV_CELL) + 8
/** At most this many cells looked at per plan: a plan never costs more than ~0.3 ms. */
const MAX_EXPAND = 3500
/** Heuristic weight: a little greedy, so a plan looks at far fewer cells for a path that's
 * hardly any longer. */
const GREED = 1.3
/** Cost of a cell next to a wall, on top of the step. */
const NEAR_COST = 1.5
/** Paths planned per tick across all the dead (the rest wait a tick). */
export const PLANS_PER_TICK = 1
/** Steering keeps this far off trees (m, on top of the trunk). */
const TREE_PAD = 0.5

/** A solid box made ready for quick point tests. */
interface Solid {
  cx: number
  cy: number
  cz: number
  hx: number
  hy: number
  hz: number
  /** Rotation (row-major 3×3): world = m · local. */
  m: number[]
  /** World footprint (with NEAR_PAD round it). */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY: number
  maxY: number
}

/** A tree trunk or rock to steer round. */
export interface Trunk {
  x: number
  z: number
  r: number
}

/** Rotation matrix of a three.js XYZ Euler (as the physics builds it). */
function rotation(r: readonly number[] | undefined): number[] {
  if (!r) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const [a = 0, b = 0, c = 0] = r
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const cc = Math.cos(c)
  const sc = Math.sin(c)
  return [
    cb * cc,
    -cb * sc,
    sb,
    ca * sc + sa * sb * cc,
    ca * cc - sa * sb * sc,
    -sa * cb,
    sa * sc - ca * sb * cc,
    sa * cc + ca * sb * sc,
    ca * cb,
  ]
}

function solidOf(box: MapBox): Solid {
  const m = rotation(box.rotation)
  const [hx, hy, hz] = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2]
  const [cx, cy, cz] = box.center
  const ex =
    Math.abs(m[0] as number) * hx + Math.abs(m[1] as number) * hy + Math.abs(m[2] as number) * hz
  const ey =
    Math.abs(m[3] as number) * hx + Math.abs(m[4] as number) * hy + Math.abs(m[5] as number) * hz
  const ez =
    Math.abs(m[6] as number) * hx + Math.abs(m[7] as number) * hy + Math.abs(m[8] as number) * hz
  return {
    cx,
    cy,
    cz,
    hx,
    hy,
    hz,
    m,
    minX: cx - ex - NEAR_PAD,
    maxX: cx + ex + NEAR_PAD,
    minZ: cz - ez - NEAR_PAD,
    maxZ: cz + ez + NEAR_PAD,
    minY: cy - ey,
    maxY: cy + ey,
  }
}

/** How far (sideways, m) the point is outside the box; -1 if it's above or below it. */
function outside(s: Solid, x: number, y: number, z: number): number {
  const dx = x - s.cx
  const dy = y - s.cy
  const dz = z - s.cz
  const m = s.m
  const ly = (m[1] as number) * dx + (m[4] as number) * dy + (m[7] as number) * dz
  if (Math.abs(ly) > s.hy) return -1
  const lx = (m[0] as number) * dx + (m[3] as number) * dy + (m[6] as number) * dz
  const lz = (m[2] as number) * dx + (m[5] as number) * dy + (m[8] as number) * dz
  return Math.hypot(Math.max(0, Math.abs(lx) - s.hx), Math.max(0, Math.abs(lz) - s.hz))
}

/** A little binary heap of cell indices ordered by cost, reused for every plan. */
class Heap {
  private ids = new Int32Array(8192)
  private keys = new Float32Array(8192)
  size = 0

  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2)
      const keys = new Float32Array(this.size * 2)
      ids.set(this.ids)
      keys.set(this.keys)
      this.ids = ids
      this.keys = keys
    }
    let i = this.size++
    while (i > 0) {
      const up = (i - 1) >> 1
      if ((this.keys[up] as number) <= key) break
      this.ids[i] = this.ids[up] as number
      this.keys[i] = this.keys[up] as number
      i = up
    }
    this.ids[i] = id
    this.keys[i] = key
  }

  pop(): number {
    const top = this.ids[0] as number
    const n = --this.size
    const id = this.ids[n] as number
    const key = this.keys[n] as number
    let i = 0
    for (;;) {
      let child = i * 2 + 1
      if (child >= n) break
      if (child + 1 < n && (this.keys[child + 1] as number) < (this.keys[child] as number)) child++
      if ((this.keys[child] as number) >= key) break
      this.ids[i] = this.ids[child] as number
      this.keys[i] = this.keys[child] as number
      i = child
    }
    this.ids[i] = id
    this.keys[i] = key
    return top
  }
}

const NEIGHBOURS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const

export class Nav {
  /** Solid boxes by the chunks they (with padding) touch. */
  private readonly buckets = new Map<number, Solid[]>()
  /** Each chunk's grid once built (null: nothing solid in it). */
  private readonly grids = new Map<number, Uint8Array | null>()
  private readonly trees = new Map<number, Trunk[][]>()
  // A* working space, reused (stamped instead of cleared).
  private readonly cost = new Float32Array(WINDOW * WINDOW)
  private readonly from = new Int32Array(WINDOW * WINDOW)
  private readonly seen = new Uint32Array(WINDOW * WINDOW)
  private readonly done = new Uint32Array(WINDOW * WINDOW)
  private stamp = 0
  private readonly heap = new Heap()
  private lastKey = -1
  private lastGrid: Uint8Array | null = null
  private budgetTick = -1
  private budgetLeft = 0
  /** Counters, for tests and the curious. */
  readonly stats = { plans: 0, built: 0, buildMs: 0, planMs: 0, maxPlanMs: 0, expanded: 0 }

  constructor(
    boxes: readonly MapBox[],
    private readonly def: SurvivalDef,
  ) {
    for (const box of boxes) {
      if (box.collide === false || FOLIAGE_MATERIALS.has(box.material)) continue
      const s = solidOf(box)
      // Lying flat on the ground (roads, floors, rugs): nothing to walk round.
      if (
        s.maxY - s.minY < 0.6 &&
        s.maxY < heightAt(def.terrain, s.cx, s.cz) + (BODY[0] as number) - 0.05
      )
        continue
      const [x0, z0] = this.chunkAt(s.minX, s.minZ)
      const [x1, z1] = this.chunkAt(s.maxX, s.maxZ)
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = cx * CHUNKS + cz
          const list = this.buckets.get(key)
          if (list) list.push(s)
          else this.buckets.set(key, [s])
        }
      }
    }
  }

  private chunkAt(x: number, z: number): [number, number] {
    const c = (v: number) => Math.max(0, Math.min(CHUNKS - 1, Math.floor((v + WORLD_HALF) / CHUNK)))
    return [c(x), c(z)]
  }

  /** The grid of one chunk, built the first time it's asked for. */
  private grid(cx: number, cz: number): Uint8Array | null {
    const key = cx * CHUNKS + cz
    const have = this.grids.get(key)
    if (have !== undefined) return have
    const solids = this.buckets.get(key)
    if (!solids) {
      this.grids.set(key, null)
      return null
    }
    const t0 = performance.now()
    const grid = new Uint8Array(SIDE * SIDE)
    const x0 = cx * CHUNK - WORLD_HALF
    const z0 = cz * CHUNK - WORLD_HALF
    const ground = new Float32Array(SIDE * SIDE).fill(Number.NaN)
    for (const s of solids) {
      const i0 = Math.max(0, Math.floor((s.minX - x0) / NAV_CELL))
      const i1 = Math.min(SIDE - 1, Math.floor((s.maxX - x0) / NAV_CELL))
      const j0 = Math.max(0, Math.floor((s.minZ - z0) / NAV_CELL))
      const j1 = Math.min(SIDE - 1, Math.floor((s.maxZ - z0) / NAV_CELL))
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * NAV_CELL
        for (let j = j0; j <= j1; j++) {
          const k = i * SIDE + j
          if ((grid[k] as number) & BLOCKED) continue
          const z = z0 + (j + 0.5) * NAV_CELL
          let g = ground[k] as number
          if (Number.isNaN(g)) {
            g = heightAt(this.def.terrain, x, z)
            ground[k] = g
          }
          if (s.maxY < g + (BODY[0] as number) || s.minY > g + (BODY[2] as number)) continue
          let d = Number.POSITIVE_INFINITY
          for (const h of BODY) {
            const o = outside(s, x, g + h, z)
            if (o >= 0 && o < d) d = o
          }
          if (d <= SOLID_PAD) grid[k] = BLOCKED
          else if (d <= NEAR_PAD) grid[k] = (grid[k] as number) | NEAR
        }
      }
    }
    this.grids.set(key, grid)
    this.stats.built++
    this.stats.buildMs += performance.now() - t0
    return grid
  }

  /** Flags of the cell at global cell coordinates (outside the world: blocked). */
  private flags(gx: number, gz: number): number {
    if (gx < 0 || gz < 0 || gx >= CELLS || gz >= CELLS) return BLOCKED
    const cx = Math.floor(gx / SIDE)
    const cz = Math.floor(gz / SIDE)
    // Almost every look-up is in the same chunk as the one before.
    const key = cx * CHUNKS + cz
    if (key !== this.lastKey) {
      this.lastKey = key
      this.lastGrid = this.grid(cx, cz)
    }
    const grid = this.lastGrid
    if (!grid) return 0
    return grid[(gx - cx * SIDE) * SIDE + (gz - cz * SIDE)] as number
  }

  private cellOf(v: number): number {
    return Math.floor((v + WORLD_HALF) / NAV_CELL)
  }

  private centre(g: number): number {
    return (g + 0.5) * NAV_CELL - WORLD_HALF
  }

  /** Free ground (for a body) at a point. */
  free(x: number, z: number): boolean {
    return !(this.flags(this.cellOf(x), this.cellOf(z)) & BLOCKED)
  }

  /** Is there anything solid near here at all (a grid with walls in it)? */
  built(x: number, z: number): boolean {
    const [cx, cz] = this.chunkAt(x, z)
    return this.buckets.has(cx * CHUNKS + cz)
  }

  /**
   * Can a body walk straight from `a` to `b`? Checks the line and two lines either side of it
   * (a body's width), every quarter cell.
   */
  clear(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const d = Math.hypot(dx, dz)
    if (d < 1e-3) return this.free(a.x, a.z)
    // Nothing solid anywhere near the line: the forest (most of the map).
    if (!this.anySolid(a, b)) return true
    const steps = Math.ceil(d / (NAV_CELL * 0.5))
    const px = (-dz / d) * 0.22
    const pz = (dx / d) * 0.22
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (dx * i) / steps
      const z = a.z + (dz * i) / steps
      if (!this.free(x, z)) return false
      if (i > 0 && i < steps && (!this.free(x + px, z + pz) || !this.free(x - px, z - pz)))
        return false
    }
    return true
  }

  /** Does any chunk the segment's bounds touch have solids in it? */
  private anySolid(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const [x0, z0] = this.chunkAt(Math.min(a.x, b.x) - 1, Math.min(a.z, b.z) - 1)
    const [x1, z1] = this.chunkAt(Math.max(a.x, b.x) + 1, Math.max(a.z, b.z) + 1)
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) if (this.buckets.has(cx * CHUNKS + cz)) return true
    return false
  }

  /** May somebody plan this tick? (Spreads the work: PLANS_PER_TICK at most per tick.) */
  mayPlan(tick: number): boolean {
    if (tick !== this.budgetTick) {
      this.budgetTick = tick
      this.budgetLeft = PLANS_PER_TICK
    }
    if (this.budgetLeft <= 0) return false
    this.budgetLeft--
    return true
  }

  /** The nearest free cell to (gx, gz) within a couple of metres, or null. */
  private freeNear(gx: number, gz: number): [number, number] | null {
    if (!(this.flags(gx, gz) & BLOCKED)) return [gx, gz]
    for (let r = 1; r <= 4; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [x, z] of [
          [gx + i, gz - r],
          [gx + i, gz + r],
          [gx - r, gz + i],
          [gx + r, gz + i],
        ] as const) {
          if (!(this.flags(x, z) & BLOCKED)) return [x, z]
        }
      }
    }
    return null
  }

  /**
   * A way from `a` towards `b` (A* over the grid, at most PLAN_RANGE out): corner points to walk
   * through, ending at `b` when it can be reached. When it can't (too far, or walled off), the
   * way to wherever got closest. Null when there's no way at all (or `a` is walled in).
   */
  plan(a: Point, b: Point): Point[] | null {
    const t0 = performance.now()
    this.stats.plans++
    try {
      return this.search(a, b)
    } finally {
      const ms = performance.now() - t0
      this.stats.planMs += ms
      this.stats.maxPlanMs = Math.max(this.stats.maxPlanMs, ms)
    }
  }

  private search(a: Point, b: Point): Point[] | null {
    const start = this.freeNear(this.cellOf(a.x), this.cellOf(a.z))
    if (!start) return null
    const [sx, sz] = start
    const half = WINDOW >> 1
    const ox = sx - half
    const oz = sz - half
    // A goal past the window is aimed for at the window's edge.
    let tx = this.cellOf(b.x)
    let tz = this.cellOf(b.z)
    const far = Math.max(Math.abs(tx - sx), Math.abs(tz - sz))
    const reach = half - 2
    if (far > reach) {
      tx = sx + Math.round(((tx - sx) * reach) / far)
      tz = sz + Math.round(((tz - sz) * reach) / far)
    }
    const goal = this.freeNear(tx, tz)
    if (goal) [tx, tz] = goal
    const exact = goal !== null && far <= reach

    if (++this.stamp === 0xffffffff) {
      this.stamp = 1
      this.seen.fill(0)
      this.done.fill(0)
    }
    const stamp = this.stamp
    const h = (gx: number, gz: number) => {
      const dx = Math.abs(gx - tx)
      const dz = Math.abs(gz - tz)
      return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * GREED
    }
    const heap = this.heap
    heap.size = 0
    const first = (sx - ox) * WINDOW + (sz - oz)
    this.seen[first] = stamp
    this.cost[first] = 0
    this.from[first] = -1
    heap.push(first, h(sx, sz))
    let best = first
    let bestH = h(sx, sz)
    let found = -1
    let expanded = 0
    while (heap.size > 0 && expanded < MAX_EXPAND) {
      const at = heap.pop()
      if (this.done[at] === stamp) continue
      this.done[at] = stamp
      expanded++
      const lx = Math.floor(at / WINDOW)
      const lz = at - lx * WINDOW
      const gx = lx + ox
      const gz = lz + oz
      if (gx === tx && gz === tz) {
        found = at
        break
      }
      const hh = h(gx, gz)
      if (hh < bestH) {
        bestH = hh
        best = at
      }
      const base = this.cost[at] as number
      for (const [dx, dz, step] of NEIGHBOURS) {
        const nx = lx + dx
        const nz = lz + dz
        if (nx < 0 || nz < 0 || nx >= WINDOW || nz >= WINDOW) continue
        const f = this.flags(gx + dx, gz + dz)
        if (f & BLOCKED) continue
        // Diagonals never cut a corner.
        if (dx !== 0 && dz !== 0) {
          if (this.flags(gx + dx, gz) & BLOCKED || this.flags(gx, gz + dz) & BLOCKED) continue
        }
        const n = nx * WINDOW + nz
        if (this.done[n] === stamp) continue
        const c = base + step + (f & NEAR ? NEAR_COST : 0)
        if (this.seen[n] === stamp && (this.cost[n] as number) <= c) continue
        this.seen[n] = stamp
        this.cost[n] = c
        this.from[n] = at
        heap.push(n, c + h(gx + dx, gz + dz))
      }
    }
    this.stats.expanded += expanded
    const end = found >= 0 ? found : best
    if (end === first && found < 0) return null
    // Back from the end: cell centres, then only the corners that matter.
    const cells: [number, number][] = []
    for (let at = end; at >= 0; at = this.from[at] as number) {
      const lx = Math.floor(at / WINDOW)
      cells.push([lx + ox, at - lx * WINDOW + oz])
    }
    cells.reverse()
    const points = cells.map(([gx, gz]) => ({ x: this.centre(gx), y: a.y, z: this.centre(gz) }))
    if (found >= 0 && exact) points.push({ x: b.x, y: b.y, z: b.z })
    return this.pull(a, points)
  }

  /** String-pulling: from each point kept, the furthest one it can walk to in a straight line. */
  private pull(a: Point, points: Point[]): Point[] {
    // First the turns only (a straight run of cells needs none of its middle).
    const turns: Point[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i] as Point
      const prev = points[i - 1]
      const next = points[i + 1]
      if (!prev || !next) {
        turns.push(p)
        continue
      }
      const d1x = Math.sign(Math.round((p.x - prev.x) / NAV_CELL))
      const d1z = Math.sign(Math.round((p.z - prev.z) / NAV_CELL))
      const d2x = Math.sign(Math.round((next.x - p.x) / NAV_CELL))
      const d2z = Math.sign(Math.round((next.z - p.z) / NAV_CELL))
      if (d1x !== d2x || d1z !== d2z) turns.push(p)
    }
    const out: Point[] = []
    let from: { x: number; z: number } = a
    let i = 0
    while (i < turns.length) {
      // The furthest turn it can see from here (looking at most 12 ahead).
      let j = i
      for (let k = Math.min(turns.length - 1, i + 12); k > i; k--) {
        if (this.clear(from, turns[k] as Point)) {
          j = k
          break
        }
      }
      const p = turns[j] as Point
      out.push(p)
      from = p
      i = j + 1
    }
    return out
  }

  /** Tree trunks and rocks within a few metres of a point (chunk by chunk, 8 m buckets). */
  treesNear(x: number, z: number): readonly Trunk[] {
    const [cx, cz] = this.chunkAt(x, z)
    const key = cx * CHUNKS + cz
    let buckets = this.trees.get(key)
    if (!buckets) {
      buckets = Array.from({ length: 64 }, () => [] as Trunk[])
      for (const p of chunkProps(this.def.terrain, this.def.seed, cx, cz)) {
        const solid = propSolid(p)
        if (!solid) continue
        const bx = Math.max(0, Math.min(7, Math.floor((p.x - (cx * CHUNK - WORLD_HALF)) / 8)))
        const bz = Math.max(0, Math.min(7, Math.floor((p.z - (cz * CHUNK - WORLD_HALF)) / 8)))
        buckets[bx * 8 + bz]?.push({ x: p.x, z: p.z, r: solid.radius })
      }
      this.trees.set(key, buckets)
    }
    const bx = Math.max(0, Math.min(7, Math.floor((x - (cx * CHUNK - WORLD_HALF)) / 8)))
    const bz = Math.max(0, Math.min(7, Math.floor((z - (cz * CHUNK - WORLD_HALF)) / 8)))
    return buckets[bx * 8 + bz] ?? []
  }

  /**
   * Steering round trees: the heading (yaw) to take instead of `yaw` when a trunk stands in the
   * way within a couple of metres, or `yaw` itself. Uses only the zombie's own 8 m bucket (a
   * trunk just over the line is caught by the stuck nudge).
   */
  aroundTrees(me: { x: number; z: number }, yaw: number, ahead: number): number {
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const look = Math.min(2.5, ahead)
    let worst = 0
    let side = 0
    for (const t of this.treesNear(me.x, me.z)) {
      const ox = t.x - me.x
      const oz = t.z - me.z
      const along = ox * fx + oz * fz
      if (along <= 0 || along > look + t.r) continue
      // Right of the heading is (-fz, fx).
      const lateral = ox * -fz + oz * fx
      const room = t.r + TREE_PAD
      if (Math.abs(lateral) >= room) continue
      const urgency = (room - Math.abs(lateral)) / room + (look - along) / look
      if (urgency > worst) {
        worst = urgency
        side = lateral >= 0 ? -1 : 1
      }
    }
    if (!worst) return yaw
    // Turning right lowers yaw (the view turns clockwise seen from above).
    return yaw - side * Math.min(1.1, 0.5 + worst * 0.4)
  }
}

const navs = new WeakMap<MapDef, Nav>()

/** The map's Nav (one per map, made the first time it's asked for). Null off survival maps. */
export function navFor(map: MapDef): Nav | null {
  if (!map.survival) return null
  let nav = navs.get(map)
  if (!nav) {
    nav = new Nav(map.boxes, map.survival)
    navs.set(map, nav)
  }
  return nav
}

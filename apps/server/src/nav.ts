import {
  findSpawnPoints,
  type MapDef,
  type PhysicsWorld,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  setGates,
  type Vec3,
} from '@office-fps/shared'
import type { Point } from './items.ts'

/** Grid spacing (m): fine enough to find a way through every doorway. */
const SPACING = 0.8
/** A node and its neighbours must be this close in height (same floor). */
const SAME_FLOOR = 0.3
/** Heights (above the floor) that must be clear between two neighbouring nodes. */
const PROBE_HEIGHTS = [0.4, 1.2]
const DIAGONAL = Math.SQRT2

/**
 * A walking grid over a map's floor, for zombies (and bots in co-op) to find their way round
 * walls and through doorways. Built once per map with every gate open; nodes in a gate's
 * doorway are skipped while that gate is shut.
 *
 * Distance fields: `field()` floods outwards from where you want them to go (every survivor at
 * once, say) and `next()` walks downhill from anywhere. Cheap enough to redo several times a
 * second for a few thousand nodes.
 */
export class NavGrid {
  readonly nodes: Vec3[]
  private readonly cell = new Map<string, number>()
  private readonly edges: { to: number; cost: number }[][]
  /** Gate id that blocks each node (-1 = none). */
  private readonly gateOf: Int16Array
  private readonly minX: number
  private readonly minZ: number

  constructor(map: MapDef, physics: PhysicsWorld, gatesOpen: (id: number) => boolean) {
    const area = map.spawnArea ?? { min: [0, 0], max: [0, 0] }
    this.minX = area.min[0] + SPACING / 2
    this.minZ = area.min[1] + SPACING / 2
    // Build with every gate open, so the doorways get nodes; then put the gates back.
    setGates(physics, () => true)
    try {
      this.nodes = findSpawnPoints(map, physics, SPACING)
      this.nodes.forEach((p, i) => {
        this.cell.set(this.key(p[0], p[1], p[2]), i)
      })
      this.edges = this.nodes.map((p) => this.link(p, physics))
    } finally {
      setGates(physics, gatesOpen)
    }
    this.gateOf = new Int16Array(this.nodes.length).fill(-1)
    for (const box of map.boxes) {
      if (box.gate === undefined) continue
      const [cx, , cz] = box.center
      const hx = box.size[0] / 2 + 0.7
      const hz = box.size[2] / 2 + 0.7
      this.nodes.forEach((p, i) => {
        if (Math.abs(p[0] - cx) <= hx && Math.abs(p[2] - cz) <= hz) this.gateOf[i] = box.gate ?? -1
      })
    }
  }

  get size(): number {
    return this.nodes.length
  }

  private key(x: number, y: number, z: number): string {
    const gx = Math.round((x - this.minX) / SPACING)
    const gz = Math.round((z - this.minZ) / SPACING)
    return `${gx},${gz},${Math.round(y * 2)}`
  }

  private at(x: number, y: number, z: number): number | undefined {
    return this.cell.get(this.key(x, y, z))
  }

  /** The 8 neighbours you can walk to in a straight line (diagonals only round no corner). */
  private link(p: Vec3, physics: PhysicsWorld): { to: number; cost: number }[] {
    const out: { to: number; cost: number }[] = []
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue
        const x = p[0] + dx * SPACING
        const z = p[2] + dz * SPACING
        const to = this.at(x, p[1], z)
        if (to === undefined) continue
        const q = this.nodes[to] as Vec3
        if (Math.abs(q[1] - p[1]) > SAME_FLOOR) continue
        if (dx !== 0 && dz !== 0) {
          if (this.at(p[0] + dx * SPACING, p[1], p[2]) === undefined) continue
          if (this.at(p[0], p[1], p[2] + dz * SPACING) === undefined) continue
        }
        const length = Math.hypot(q[0] - p[0], q[2] - p[2])
        let clear = true
        for (const h of PROBE_HEIGHTS) {
          ray.origin = { x: p[0], y: p[1] + h, z: p[2] }
          ray.dir = { x: (q[0] - p[0]) / length, y: 0, z: (q[2] - p[2]) / length }
          if (physics.world.castRay(ray, length, true, undefined, PLAYER_QUERY_GROUPS)) {
            clear = false
            break
          }
        }
        if (clear) out.push({ to, cost: dx !== 0 && dz !== 0 ? DIAGONAL : 1 })
      }
    }
    return out
  }

  /** The node nearest to `p` on its floor (searching a few cells around), or -1. */
  nearest(p: Point): number {
    const exact = this.at(p.x, p.y, p.z)
    if (exact !== undefined) return exact
    let best = -1
    let bestD = Number.POSITIVE_INFINITY
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const i = this.at(p.x + dx * SPACING, p.y, p.z + dz * SPACING)
        if (i === undefined) continue
        const n = this.nodes[i] as Vec3
        const d = Math.hypot(n[0] - p.x, n[2] - p.z)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
    }
    return best
  }

  /**
   * Walking distance (in grid steps) from every node to the nearest of `sources`; Infinity
   * where they can't get to (behind shut gates).
   */
  field(sources: readonly Point[], gatesOpen: (id: number) => boolean): Float64Array {
    const dist = new Float64Array(this.nodes.length).fill(Number.POSITIVE_INFINITY)
    const blocked = (i: number) => {
      const gate = this.gateOf[i] ?? -1
      return gate >= 0 && !gatesOpen(gate)
    }
    const heap = new MinHeap()
    for (const s of sources) {
      const i = this.nearest(s)
      if (i < 0 || blocked(i)) continue
      dist[i] = 0
      heap.push(i, 0)
    }
    while (heap.size > 0) {
      const [i, d] = heap.pop()
      if (d > (dist[i] ?? 0)) continue
      for (const { to, cost } of this.edges[i] ?? []) {
        const nd = d + cost
        if (nd >= (dist[to] ?? 0) || blocked(to)) continue
        dist[to] = nd
        heap.push(to, nd)
      }
    }
    return dist
  }

  /** Steps from `p` to the field's source (Infinity if it can't get there). */
  distance(field: Float64Array, p: Point): number {
    const i = this.nearest(p)
    return i < 0 ? Number.POSITIVE_INFINITY : (field[i] ?? Number.POSITIVE_INFINITY)
  }

  /**
   * Where to walk next from `p`, following `field` downhill a few nodes ahead (so the path is
   * smooth), or null if there is no way.
   */
  next(field: Float64Array, p: Point, lookahead = 3): Point | null {
    let i = this.nearest(p)
    if (i < 0 || !Number.isFinite(field[i] ?? Number.POSITIVE_INFINITY)) return null
    for (let step = 0; step < lookahead; step++) {
      let best = i
      for (const { to } of this.edges[i] ?? []) {
        if ((field[to] ?? Number.POSITIVE_INFINITY) < (field[best] ?? Number.POSITIVE_INFINITY)) {
          best = to
        }
      }
      if (best === i) break
      i = best
    }
    const n = this.nodes[i] as Vec3
    return { x: n[0], y: n[1], z: n[2] }
  }
}

/** Binary min-heap of (node, priority). */
class MinHeap {
  private readonly ids: number[] = []
  private readonly keys: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, key: number): void {
    this.ids.push(id)
    this.keys.push(key)
    let i = this.ids.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((this.keys[parent] ?? 0) <= key) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.ids[0] ?? 0, this.keys[0] ?? 0]
    const lastId = this.ids.pop() ?? 0
    const lastKey = this.keys.pop() ?? 0
    if (this.ids.length > 0) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.ids.length && (this.keys[l] ?? 0) < (this.keys[m] ?? 0)) m = l
        if (r < this.ids.length && (this.keys[r] ?? 0) < (this.keys[m] ?? 0)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a] ?? 0
    const key = this.keys[a] ?? 0
    this.ids[a] = this.ids[b] ?? 0
    this.keys[a] = this.keys[b] ?? 0
    this.ids[b] = id
    this.keys[b] = key
  }
}

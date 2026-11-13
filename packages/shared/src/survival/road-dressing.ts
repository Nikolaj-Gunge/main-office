import type { MapBox, MapLight, MaterialId, Vec3 } from '../maps/types.ts'
import type { WorldBuild } from './kit.ts'
import { hash2 } from './noise.ts'
import type { Lake, Poi, Road } from './types.ts'

/**
 * What the roads of Deadwood have along them: streetlamps (most of them dead), wooden power
 * poles with their wires sagging between them, road signs, mile markers, guard rails on the
 * bends and the odd cone or drum left behind. Lamp posts, power poles, sign posts and drums are
 * solid (map boxes, so the server collides with them); everything else is decoration. Sign faces
 * are drawn by the client from `SurvivalDef.signs`.
 *
 * Solid things are placed with plain arithmetic (+ − × ÷ and sqrt, no trig), so the client
 * and the server put them in exactly the same spot.
 */

/** A road sign's face (the post is a map box). */
export interface RoadSign {
  kind: 'guide' | 'speed' | 'mile' | 'warn' | 'graffiti'
  /** Centre of the face. */
  pos: Vec3
  /** Which way the face looks (unit vector on the ground plane). */
  facing: [number, number]
  /** Face size (m). */
  w: number
  h: number
  /** What it says, one entry per line. */
  lines: string[]
  /** An arrow under the text. */
  arrow?: 'left' | 'right' | 'up'
  /** Hangs crooked: roll in radians (a loose bolt, a shot-up sign). */
  askew?: number
}

/** Ground and places the dressing has to keep out of. */
export interface RoadsideWorld {
  roads: readonly Road[]
  pois: readonly Poi[]
  lakes: readonly Lake[]
  groundAt(x: number, z: number): number
}

/** Streetlamps this far apart near towns, gas stations and Haven (m)… */
const LAMP_TOWN = 44
/** …and out in the woods, where only a few were ever put up. */
const LAMP_WILD = 230
/** Power poles this far apart. */
const POLE_SPAN = 46
/** A speed-limit sign every so often, and a mile marker. */
const SPEED_EVERY = 620
const MILE_EVERY = 500

/** Places with streetlights on the roads into them, and how far out the lamps go (m). */
const LIT: Partial<Record<Poi['kind'], number>> = {
  town: 140,
  gas: 90,
  camp: 160,
  motel: 70,
  church: 50,
  checkpoint: 70,
}

/** Distance from (x, z) to the segment a–b on the ground plane. */
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
  const ex = ax + dx * t - x
  const ez = az + dz * t - z
  return Math.sqrt(ex * ex + ez * ez)
}

/** The roads' centre lines bucketed in a coarse grid, for "how far is the nearest road?" */
export class RoadGrid {
  private readonly cells = new Map<number, number[]>()
  private readonly roads: readonly Road[]
  private readonly cell: number

  constructor(roads: readonly Road[], cell = 16) {
    this.roads = roads
    this.cell = cell
    roads.forEach((road, r) => {
      for (let i = 0; i + 1 < road.line.length; i++) {
        const a = road.line[i] as Road['line'][number]
        const b = road.line[i + 1] as Road['line'][number]
        const keys = new Set([this.key(a.x, a.z), this.key(b.x, b.z)])
        for (const k of keys) {
          const list = this.cells.get(k) ?? []
          list.push(r, i)
          this.cells.set(k, list)
        }
      }
    })
  }

  private key(x: number, z: number): number {
    return Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell)
  }

  /**
   * The nearest road centre line within about one grid cell of (x, z): its distance, the road
   * and its index, or null when no road is that close. `skip` leaves one road out.
   */
  nearest(x: number, z: number, skip = -1): { d: number; road: Road; index: number } | null {
    let best: { d: number; road: Road; index: number } | null = null
    const cx = Math.floor(x / this.cell)
    const cz = Math.floor(z / this.cell)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const list = this.cells.get(i * 100003 + j)
        if (!list) continue
        for (let k = 0; k < list.length; k += 2) {
          const r = list[k] as number
          if (r === skip) continue
          const road = this.roads[r] as Road
          const s = list[k + 1] as number
          const a = road.line[s] as Road['line'][number]
          const b = road.line[s + 1] as Road['line'][number]
          const d = segmentDistance(x, z, a.x, a.z, b.x, b.z)
          if (!best || d < best.d) best = { d, road, index: r }
        }
      }
    }
    return best
  }

  /** How far (x, z) is from the edge of the nearest road (negative: on it); Infinity far away. */
  edgeDistance(x: number, z: number, skip = -1): number {
    const n = this.nearest(x, z, skip)
    return n ? n.d - n.road.width / 2 : Number.POSITIVE_INFINITY
  }
}

/** Every box's footprint, bucketed, for "would this stand inside something already built?" */
class BoxGrid {
  private readonly cells = new Map<number, MapBox[]>()
  private readonly groundAt: (x: number, z: number) => number

  constructor(boxes: readonly MapBox[], groundAt: (x: number, z: number) => number) {
    this.groundAt = groundAt
    for (const box of boxes) this.add(box)
  }

  add(box: MapBox): void {
    // Flat things on the ground (paving, floors, decals) don't stop a post.
    const top = box.center[1] + box.size[1] / 2
    if (top < this.groundAt(box.center[0], box.center[2]) + 0.3) return
    const r = box.rotation ? Math.max(box.size[0], box.size[2]) / 2 : 0
    const hx = r || box.size[0] / 2
    const hz = r || box.size[2] / 2
    for (
      let i = Math.floor((box.center[0] - hx) / 8);
      i <= Math.floor((box.center[0] + hx) / 8);
      i++
    )
      for (
        let j = Math.floor((box.center[2] - hz) / 8);
        j <= Math.floor((box.center[2] + hz) / 8);
        j++
      ) {
        const key = i * 100003 + j
        const list = this.cells.get(key) ?? []
        list.push(box)
        this.cells.set(key, list)
      }
  }

  /** Anything within `r` of (x, z)? */
  blocked(x: number, z: number, r: number): boolean {
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++)
      for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++)
        for (const box of this.cells.get(i * 100003 + j) ?? []) {
          const e = box.rotation ? Math.max(box.size[0], box.size[2]) / 2 : 0
          const hx = (e || box.size[0] / 2) + r
          const hz = (e || box.size[2] / 2) + r
          if (Math.abs(x - box.center[0]) < hx && Math.abs(z - box.center[2]) < hz) return true
        }
    return false
  }
}

/** A point along a road: where it is and which way the road runs. */
interface Station {
  x: number
  z: number
  /** Unit direction of travel, and the unit normal to its right (x east, z south). */
  tx: number
  tz: number
  nx: number
  nz: number
  /** Index of the line point it is nearest to. */
  i: number
}

/** Road length so far at each point of its line. */
function lengths(road: Road): number[] {
  const out = [0]
  for (let i = 1; i < road.line.length; i++) {
    const a = road.line[i - 1] as Road['line'][number]
    const b = road.line[i] as Road['line'][number]
    out.push((out[i - 1] as number) + Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2))
  }
  return out
}

/** The point `s` metres along a road, its direction smoothed over ±`smooth` line points. */
function stationAt(road: Road, cum: readonly number[], s: number, smooth = 3): Station {
  // The last point at or before s (binary search).
  let lo = 0
  let hi = cum.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((cum[mid] as number) <= s) lo = mid
    else hi = mid - 1
  }
  const i = Math.max(0, lo)
  const a = road.line[i] as Road['line'][number]
  const b = road.line[i + 1] as Road['line'][number]
  const seg = (cum[i + 1] as number) - (cum[i] as number) || 1
  const f = Math.max(0, Math.min(1, (s - (cum[i] as number)) / seg))
  const p = road.line[Math.max(0, i - smooth)] as Road['line'][number]
  const q = road.line[Math.min(road.line.length - 1, i + 1 + smooth)] as Road['line'][number]
  const l = Math.sqrt((q.x - p.x) ** 2 + (q.z - p.z) ** 2) || 1
  const tx = (q.x - p.x) / l
  const tz = (q.z - p.z) / l
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    tx,
    tz,
    nx: -tz,
    nz: tx,
    i: f < 0.5 ? i : i + 1,
  }
}

/** Yaw (radians about y) that turns a box's local x axis to point along (dx, dz). */
const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx)

/**
 * Dresses the roads of a finished world build: adds the boxes and lights to `build` and returns
 * the sign faces for the client to draw.
 */
export function dressRoads(build: WorldBuild, w: RoadsideWorld, seed: number): RoadSign[] {
  const signs: RoadSign[] = []
  const roadGrid = new RoadGrid(w.roads)
  const boxGrid = new BoxGrid(build.boxes, w.groundAt)
  const lightsBefore = build.lights.map((l) => l.pos)
  // The insides of buildings count as taken too, with a metre to spare.
  for (const room of build.rooms) {
    const cx = (room.min[0] + room.max[0]) / 2
    const cz = (room.min[1] + room.max[1]) / 2
    boxGrid.add({
      center: [cx, w.groundAt(cx, cz) + 5, cz],
      size: [room.max[0] - room.min[0] + 2, 10, room.max[1] - room.min[1] + 2],
      material: 'floor',
    })
  }
  const roll = (a: number, b: number, salt: number) => hash2(a, b, seed + salt)

  const box = (
    center: Vec3,
    size: Vec3,
    material: MaterialId,
    solid: boolean,
    rotation?: Vec3,
  ): void => {
    const placed: MapBox = {
      center,
      size,
      material,
      ...(rotation ? { rotation } : {}),
      ...(solid ? {} : { collide: false }),
    }
    build.boxes.push(placed)
    // Wires overhead don't stop anything standing below them.
    if (size[0] < 20 && (solid || size[1] > 0.05)) boxGrid.add(placed)
  }
  /** A thin deco bar from a to b (wires, rails, arms). */
  const bar = (a: Vec3, b: Vec3, thick: number, height: number, material: MaterialId) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const flat = Math.sqrt(dx * dx + dz * dz)
    const length = Math.sqrt(flat * flat + dy * dy)
    if (length < 0.01) return
    box(
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      [length, height, thick],
      material,
      false,
      [0, yawOf(dx, dz), Math.atan2(dy, flat)],
    )
  }

  /** May something `r` wide stand at (x, z)? Off every road, out of buildings and the lake. */
  const free = (x: number, z: number, r: number, roadClear = 0.6): boolean => {
    if (roadGrid.edgeDistance(x, z) < roadClear + r) return false
    if (boxGrid.blocked(x, z, r + 0.4)) return false
    for (const lake of w.lakes) {
      const dx = x - lake.x
      const dz = z - lake.z
      if (dx * dx + dz * dz < (lake.r + 10) ** 2) return false
    }
    return true
  }
  /** The nearest place with streetlights within its lit reach of (x, z), if any. */
  const litBy = (x: number, z: number): Poi | null => {
    for (const p of w.pois) {
      const reach = LIT[p.kind]
      if (reach === undefined) continue
      const dx = x - p.x
      const dz = z - p.z
      if (dx * dx + dz * dz < (p.r + reach) ** 2) return p
    }
    return null
  }
  const lampNear = (x: number, z: number, r: number) =>
    lightsBefore.some((p) => (p[0] - x) ** 2 + (p[2] - z) ** 2 < r * r)

  // --- Streetlamps -----------------------------------------------------------------------------

  const lamp = (st: Station, side: 1 | -1, half: number, r: number, k: number, haven: boolean) => {
    const px = st.x + st.nx * side * (half + 1.3)
    const pz = st.z + st.nz * side * (half + 1.3)
    if (!free(px, pz, 0.3) || lampNear(px, pz, 12)) return false
    const y = w.groundAt(px, pz)
    const h = 6.6
    box([px, y + 0.25, pz], [0.42, 0.5, 0.42], 'concrete', true)
    box([px, y + h / 2, pz], [0.18, h, 0.18], 'metal', true)
    // The arm reaches out over the road; the head hangs at its end.
    const ax = -st.nx * side
    const az = -st.nz * side
    const fate = roll(r, k, 41)
    // Some heads have been knocked off or hang by their wires.
    const headless = fate < 0.12
    const drooping = fate >= 0.12 && fate < 0.22
    const reach = 1.9
    const hx = px + ax * reach
    const hz = pz + az * reach
    bar([px, y + h - 0.1, pz], [hx, y + h + (drooping ? -0.9 : 0.15), hz], 0.1, 0.1, 'metal')
    const lit = haven ? fate > 0.15 : fate > 0.5
    if (headless) return true
    const headY = y + h + (drooping ? -1.05 : 0.02)
    box([hx, headY, hz], [0.7, 0.16, 0.34], lit ? 'lightpanel' : 'metal', false, [
      0,
      yawOf(ax, az),
      drooping ? -0.9 : 0,
    ])
    if (lit) {
      const flicker = haven ? 0 : roll(r, k, 43) < 0.4 ? 0.45 + roll(r, k, 44) * 0.5 : 0
      build.lights.push({
        kind: 'point',
        pos: [hx, headY - 0.4, hz],
        color: haven ? 0xffd2a0 : 0xffaa55,
        intensity: 130,
        distance: 24,
        ...(flicker ? { flicker } : {}),
      } satisfies MapLight)
    }
    return true
  }

  // --- Power poles and their wires -------------------------------------------------------------

  const poleTop = (st: Station, side: 1 | -1, half: number): Vec3 | null => {
    const px = st.x + st.nx * side * (half + 3)
    const pz = st.z + st.nz * side * (half + 3)
    if (!free(px, pz, 0.25)) return null
    const y = w.groundAt(px, pz)
    box([px, y + 4.1, pz], [0.26, 8.2, 0.26], 'log', true)
    return [px, y + 7.7, pz]
  }

  const wires = (
    a: Vec3,
    b: Vec3,
    an: [number, number],
    bn: [number, number],
    r: number,
    k: number,
  ) => {
    const span = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2)
    const snapped = roll(r, k, 51) < 0.08
    for (const off of [-0.75, 0.75]) {
      const from: Vec3 = [a[0] + an[0] * off, a[1] + 0.12, a[2] + an[1] * off]
      const to: Vec3 = [b[0] + bn[0] * off, b[1] + 0.12, b[2] + bn[1] * off]
      if (snapped && off > 0) {
        // A wire that came down: it hangs from the pole and lies along the verge.
        const g = w.groundAt((from[0] * 2 + to[0]) / 3, (from[2] * 2 + to[2]) / 3)
        const mid: Vec3 = [(from[0] * 3 + to[0]) / 4, g + 0.05, (from[2] * 3 + to[2]) / 4]
        bar(from, mid, 0.04, 0.04, 'asphalt')
        const end: Vec3 = [
          (from[0] + to[0]) / 2,
          w.groundAt((from[0] + to[0]) / 2, (from[2] + to[2]) / 2) + 0.03,
          (from[2] + to[2]) / 2,
        ]
        bar(mid, end, 0.04, 0.04, 'asphalt')
        continue
      }
      const sag = 0.6 + span * 0.018
      const pts: Vec3[] = []
      for (let s = 0; s <= 4; s++) {
        const t = s / 4
        pts.push([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t - sag * 4 * t * (1 - t),
          from[2] + (to[2] - from[2]) * t,
        ])
      }
      for (let s = 0; s < 4; s++) bar(pts[s] as Vec3, pts[s + 1] as Vec3, 0.04, 0.04, 'asphalt')
    }
  }

  // --- Signs -----------------------------------------------------------------------------------

  const sign = (
    st: Station,
    side: 1 | -1,
    half: number,
    face: Omit<RoadSign, 'pos' | 'facing'>,
    /** The sign faces traffic driving along +t (true) or against it. */
    forward: boolean,
    postH: number,
    clear = 1.6,
  ): boolean => {
    const px = st.x + st.nx * side * (half + clear)
    const pz = st.z + st.nz * side * (half + clear)
    if (!free(px, pz, Math.max(0.1, face.w / 2), 0.2)) return false
    const y = w.groundAt(px, pz)
    // The post runs up behind the face; wide boards stand on two legs.
    const postW = face.kind === 'guide' ? 0.12 : 0.07
    const tall = postH + face.h * 0.85
    const material: MaterialId = face.kind === 'graffiti' ? 'wood' : 'metal'
    const legs = face.kind === 'guide' && face.w > 1.6 ? [-1, 1] : [0]
    for (const leg of legs) {
      const off = leg * (face.w / 2 - 0.3)
      box([px + st.nx * off, y + tall / 2, pz + st.nz * off], [postW, tall, postW], material, true)
    }
    const f = forward ? -1 : 1
    // Slightly in front of the posts, towards the drivers it faces.
    const fx = st.tx * f
    const fz = st.tz * f
    signs.push({
      ...face,
      pos: [px + fx * 0.08, y + postH + face.h / 2 - 0.05, pz + fz * 0.08],
      facing: [fx, fz],
    })
    return true
  }

  const towns = w.pois.filter((p) => p.kind === 'town' || p.kind === 'camp')
  const haven = w.pois.find((p) => p.kind === 'camp')
  const km = (d: number) => `${(d / 1000).toFixed(1)} km`

  w.roads.forEach((road, r) => {
    const cum = lengths(road)
    const total = cum[cum.length - 1] as number
    const half = road.width / 2
    const asphalt = road.kind === 'asphalt'

    // Lamps on one side, poles on the other.
    if (asphalt) {
      let next = 12
      let k = 0
      for (let s = 12; s < total - 6; s += 4) {
        if (s < next) continue
        const st = stationAt(road, cum, s)
        const by = litBy(st.x, st.z)
        const spacing = by ? LAMP_TOWN : LAMP_WILD
        if (!by && roll(r, Math.floor(s / LAMP_WILD), 45) > 0.6) {
          next = s + spacing
          continue
        }
        k++
        if (lamp(st, k % 2 === 0 || !by ? 1 : -1, half, r, k, by?.kind === 'camp'))
          next = s + spacing
      }
    }
    // Wires run along the paved roads and some of the tracks to farms and mills.
    if (asphalt || roll(r, 0, 52) < 0.5) {
      let last: { top: Vec3; n: [number, number]; s: number } | null = null
      let k = 0
      for (let s = 8; s < total - 4; s += 3) {
        if (last && s - last.s < POLE_SPAN) continue
        const st = stationAt(road, cum, s, 6)
        const top = poleTop(st, -1, half)
        if (!top) continue
        k++
        const n: [number, number] = [st.nx, st.nz]
        box([top[0], top[1] + 0.05, top[2]], [0.12, 0.12, 1.9], 'wood', false, [
          0,
          yawOf(st.tx, st.tz),
          0,
        ])
        if (last && s - last.s < POLE_SPAN * 2.2) wires(last.top, top, last.n, n, r, k)
        last = { top, n, s }
      }
    }

    // Guard rails and a warning sign where the road bends hard.
    if (asphalt) {
      let lastBend = -1e9
      for (let i = 8; i + 8 < road.line.length; i++) {
        const a = road.line[i - 8] as Road['line'][number]
        const b = road.line[i] as Road['line'][number]
        const c = road.line[i + 8] as Road['line'][number]
        const ux = b.x - a.x
        const uz = b.z - a.z
        const vx = c.x - b.x
        const vz = c.z - b.z
        const lu = Math.sqrt(ux * ux + uz * uz) || 1
        const lv = Math.sqrt(vx * vx + vz * vz) || 1
        const cos = (ux * vx + uz * vz) / (lu * lv)
        const s0 = cum[i] as number
        if (cos > 0.95 || s0 - lastBend < 80 || s0 < 30 || total - s0 < 30) continue
        if (litBy(b.x, b.z)) continue
        lastBend = s0
        // Turning right (cross > 0) puts the outside of the bend on the left.
        const cross = (ux * vz - uz * vx) / (lu * lv)
        const out: 1 | -1 = cross > 0 ? -1 : 1
        let prev: Vec3 | null = null
        for (let d = -16; d <= 16; d += 3.2) {
          const st = stationAt(road, cum, s0 + d, 4)
          const px = st.x + st.nx * out * (half + 0.9)
          const pz = st.z + st.nz * out * (half + 0.9)
          if (!free(px, pz, 0.05, 0.3)) {
            prev = null
            continue
          }
          const y = w.groundAt(px, pz)
          box([px, y + 0.4, pz], [0.12, 0.8, 0.12], 'metal', false)
          const rail: Vec3 = [px, y + 0.62, pz]
          if (prev) bar(prev, rail, 0.06, 0.3, 'metal')
          prev = rail
        }
        // Warn the drivers coming each way.
        for (const forward of [true, false]) {
          const st = stationAt(road, cum, s0 + (forward ? -45 : 45))
          const side = forward ? 1 : -1
          sign(
            st,
            side,
            half,
            {
              kind: 'warn',
              w: 0.8,
              h: 0.8,
              lines: [],
              arrow: cross > 0 === forward ? 'right' : 'left',
            },
            forward,
            1.6,
          )
        }
      }
    }

    // Speed limits, mile markers, and the odd sign someone painted.
    if (asphalt) {
      for (let s = 140; s < total - 40; s += SPEED_EVERY) {
        const st = stationAt(road, cum, s)
        sign(
          st,
          1,
          half,
          {
            kind: 'speed',
            w: 0.62,
            h: 0.8,
            lines: ['SPEED', 'LIMIT', litBy(st.x, st.z) ? '25' : '45'],
          },
          true,
          1.7,
        )
      }
      for (let s = MILE_EVERY, n = 1; s < total - 20; s += MILE_EVERY, n++) {
        const st = stationAt(road, cum, s)
        sign(
          st,
          -1,
          half,
          { kind: 'mile', w: 0.3, h: 0.5, lines: ['MILE', String(n)] },
          false,
          0.8,
          0.9,
        )
      }
    }
    const SCRAWL = [
      ['TURN', 'BACK'],
      ['THEY HEAR', 'YOU'],
      ['HAVEN', 'IS SAFE'],
      ['NO GAS'],
      ['DONT STOP'],
      ['HELP US'],
      ['INFECTED', 'KEEP OUT'],
    ]
    for (let s = 260; s < total - 60; s += 300) {
      if (roll(r, Math.floor(s), 61) > 0.3) continue
      const st = stationAt(road, cum, s)
      const words = SCRAWL[Math.floor(roll(r, Math.floor(s), 62) * SCRAWL.length)] as string[]
      const forward = roll(r, Math.floor(s), 63) < 0.5
      sign(
        st,
        forward ? 1 : -1,
        half,
        {
          kind: 'graffiti',
          w: 1.2,
          h: 0.8,
          lines: words,
          askew: (roll(r, Math.floor(s), 64) - 0.5) * 0.4,
        },
        forward,
        1.1,
        1.8,
      )
    }

    // Town names where a road comes into town, each way.
    for (const town of towns) {
      const edge = town.r + 45
      let wasIn: boolean | null = null
      for (let s = 0; s < total; s += 4) {
        const st = stationAt(road, cum, s)
        const inside = (st.x - town.x) ** 2 + (st.z - town.z) ** 2 < edge * edge
        if (wasIn !== null && inside !== wasIn) {
          // Coming in along +t: the sign is on the right, facing back up the road.
          const forward = inside
          const back = stationAt(road, cum, s + (forward ? -6 : 6))
          sign(
            back,
            forward ? 1 : -1,
            half,
            {
              kind: 'guide',
              w: 2.2,
              h: 1,
              lines: [town.name.toUpperCase(), town.kind === 'camp' ? 'SURVIVORS' : 'POP. 0'],
            },
            forward,
            1.9,
            2,
          )
        }
        wasIn = inside
      }
    }

    // At junctions: which way Haven (or the nearest town) lies.
    if (haven) {
      for (const [end, forward] of [
        [0, true],
        [total, false],
      ] as const) {
        const st0 = stationAt(road, cum, end)
        const other = roadGrid.nearest(st0.x, st0.z, r)
        if (!other || other.d > 8) continue
        const st = stationAt(road, cum, forward ? Math.min(total, 22) : Math.max(0, total - 22))
        let target: Poi = haven
        const dh = Math.sqrt((haven.x - st0.x) ** 2 + (haven.z - st0.z) ** 2)
        if (dh < 150 || dh > 1600) {
          // Haven is right here or far off: point at the nearest town instead.
          let best = Number.POSITIVE_INFINITY
          for (const t of towns) {
            const d = Math.sqrt((t.x - st0.x) ** 2 + (t.z - st0.z) ** 2)
            if (d > 150 && d < best) {
              best = d
              target = t
            }
          }
        }
        const vx = target.x - st0.x
        const vz = target.z - st0.z
        const vl = Math.sqrt(vx * vx + vz * vz) || 1
        // Driving towards the junction.
        const dx = forward ? -st0.tx : st0.tx
        const dz = forward ? -st0.tz : st0.tz
        const along = (dx * vx + dz * vz) / vl
        const turn = (dx * vz - dz * vx) / vl
        const arrow = along > 0.8 ? 'up' : turn > 0 ? 'right' : 'left'
        sign(
          st,
          forward ? -1 : 1,
          half,
          { kind: 'guide', w: 1.9, h: 1.1, lines: [target.name.toUpperCase(), km(vl)], arrow },
          !forward,
          1.9,
          1.8,
        )
      }
    }

    // Cones and drums left on the shoulder from a roadblock long gone.
    if (asphalt) {
      for (let s = 90; s < total - 40; s += 170) {
        const k = Math.floor(s)
        if (roll(r, k, 71) > 0.28) continue
        const st = stationAt(road, cum, s)
        const side: 1 | -1 = roll(r, k, 72) < 0.5 ? 1 : -1
        const cones = 2 + Math.floor(roll(r, k, 73) * 4)
        for (let c = 0; c < cones; c++) {
          const along = (c - cones / 2) * 2.4
          const across = half - 0.4 + roll(r, k + c, 74) * 1.2
          const x = st.x + st.tx * along + st.nx * side * across
          const z = st.z + st.tz * along + st.nz * side * across
          if (boxGrid.blocked(x, z, 0.3)) continue
          const y = w.groundAt(x, z)
          const fallen = roll(r, k + c, 75) < 0.3
          box([x, y + 0.03, z], [0.36, 0.06, 0.36], 'asphalt', false)
          box(
            [x, y + (fallen ? 0.17 : 0.3), z],
            fallen ? [0.55, 0.2, 0.2] : [0.2, 0.55, 0.2],
            'accent',
            false,
            [0, roll(r, k + c, 76) * 6.28, 0],
          )
        }
        if (roll(r, k, 77) < 0.5) {
          const x = st.x + st.nx * side * (half + 1.6)
          const z = st.z + st.nz * side * (half + 1.6)
          if (free(x, z, 0.35, 0.4))
            box([x, w.groundAt(x, z) + 0.45, z], [0.6, 0.9, 0.6], 'rust', true)
        }
      }
    }
  })
  return signs
}

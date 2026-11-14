import type { BoxFlags } from '../maps/builder.ts'
import type { MapBox, MapLabel, MapLight, MaterialId, Vec3 } from '../maps/types.ts'
import type { LootTable } from './items.ts'
import type {
  BoardSpot,
  Interactable,
  InteractKind,
  Lake,
  LootSpot,
  Npc,
  NpcRole,
  Poi,
  Room,
} from './types.ts'

/** Everything the places of the world add up to. */
export interface WorldBuild {
  boxes: MapBox[]
  lights: MapLight[]
  labels: MapLabel[]
  loot: LootSpot[]
  zombieSpots: { pos: Vec3; poi: number }[]
  npcs: Npc[]
  interactables: Interactable[]
  rooms: Room[]
  spots: BoardSpot[]
}

export function emptyBuild(): WorldBuild {
  return {
    boxes: [],
    lights: [],
    labels: [],
    loot: [],
    zombieSpots: [],
    npcs: [],
    interactables: [],
    rooms: [],
    spots: [],
  }
}

/** What a place may ask about the world around it while it is built. */
export interface PlaceWorld {
  /** Ground height at a world point. */
  groundAt(x: number, z: number): number
  lakes: readonly Lake[]
}

export const DECO: BoxFlags = { collide: false }
/** Wall thickness (m). */
export const WALL = 0.2
/** Doorways: wide and high enough for anybody, dead or alive. */
export const DOOR_W = 1.4
export const DOOR_H = 2.2

export interface LampOptions {
  color?: number
  intensity?: number
  distance?: number
  flicker?: number
}

/** A side of a building: north is −z, east is +x (before the site is turned). */
export type Side = 'n' | 's' | 'e' | 'w'

/** A gap in a wall: where along it (metres from the wall's middle) and how wide. */
export interface Opening {
  side: Side
  at: number
  width?: number
  /** Doors reach the floor; windows start at `sill` and are `height` tall. */
  sill?: number
  height?: number
  /** Windows: glass in it (it blocks bullets and bodies; you see through). */
  glass?: boolean
  /** Windows: boarded up (planks across; nothing gets through). */
  boards?: boolean
}

export interface ShellOptions {
  /** Outer width (x) and depth (z), and wall height. */
  w: number
  d: number
  h: number
  wall: MaterialId
  floor?: MaterialId
  /** Ceiling/roof slab material; omit for no roof (ruins, yards). */
  roof?: MaterialId
  doors?: Opening[]
  windows?: Opening[]
  /** A pitched roof on top (ridge along the longer side), this many metres high. */
  pitch?: number
  /** Leave it out of the rooms the dead path into (sheds too small to matter). */
  noRoom?: boolean
  /**
   * What the trim is made of (frames round the doors and windows, corner posts, skirting, the
   * roof's fascia), or false for none. By default it suits the walls (see trimFor).
   */
  trim?: MaterialId | false
}

/** The trim that suits a building's walls; null for walls that get none (glass, ruins, RVs). */
export function trimFor(wall: MaterialId): MaterialId | null {
  switch (wall) {
    case 'brick':
    case 'plaster':
    case 'concrete':
    case 'wood':
    case 'barn':
      return 'trim'
    case 'log':
      return 'wood'
    case 'metal':
    case 'rust':
      return 'metal'
    default:
      return null
  }
}

/** How far trim stands proud of a wall's face (m), and how wide frames are. */
const TRIM_OUT = 0.04
const FRAME = 0.07
/** Top of the concrete footing round a building's base. */
const FOOTING = 0.26

/**
 * Builds one place: everything is given in the place's own coordinates (x east, z south, y up
 * from its ground) and may be turned in quarter turns, so boxes stay axis-aligned.
 */
export class Site {
  private readonly build: WorldBuild
  readonly poi: Poi
  private readonly index: number
  private readonly ox: number
  private readonly oz: number
  private readonly turn: number

  constructor(build: WorldBuild, poi: Poi, index: number, ox = 0, oz = 0, turn = 0) {
    this.build = build
    this.poi = poi
    this.index = index
    this.ox = ox
    this.oz = oz
    this.turn = ((turn % 4) + 4) % 4
  }

  /** A site inside this one: moved by (dx, dz) and turned `turn` more quarter turns clockwise. */
  sub(dx: number, dz: number, turn = 0): Site {
    const [x, z] = this.rotate(dx, dz)
    return new Site(this.build, this.poi, this.index, this.ox + x, this.oz + z, this.turn + turn)
  }

  /** The same site standing `dy` higher: decks on stilts, floors raised off the ground. */
  lifted(dy: number): Site {
    const poi = { ...this.poi, y: this.poi.y + dy }
    return new Site(this.build, poi, this.index, this.ox, this.oz, this.turn)
  }

  private rotate(x: number, z: number): [number, number] {
    switch (this.turn) {
      case 1:
        return [-z, x]
      case 2:
        return [-x, -z]
      case 3:
        return [z, -x]
      default:
        return [x, z]
    }
  }

  /** Local point → world. */
  world(x: number, y: number, z: number): Vec3 {
    const [rx, rz] = this.rotate(x, z)
    return [this.poi.x + this.ox + rx, this.poi.y + y, this.poi.z + this.oz + rz]
  }

  /** Local yaw (degrees, 0 = facing north/−z, positive turns left) → world radians. */
  yaw(deg: number): number {
    return (deg * Math.PI) / 180 - (this.turn * Math.PI) / 2
  }

  /** A box standing on (x, y, z): `w` wide (x), `h` high, `d` deep (z). */
  block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: MaterialId,
    flags: BoxFlags = {},
  ): this {
    const odd = this.turn % 2 === 1
    const [cx, cy, cz] = this.world(x, y + h / 2, z)
    this.build.boxes.push({
      center: [cx, cy, cz],
      size: [odd ? d : w, h, odd ? w : d],
      material,
      ...flags,
    })
    return this
  }

  /** A box between two opposite corners. */
  span(a: Vec3, b: Vec3, material: MaterialId, flags: BoxFlags = {}): this {
    return this.block(
      (a[0] + b[0]) / 2,
      Math.min(a[1], b[1]),
      (a[2] + b[2]) / 2,
      Math.abs(a[0] - b[0]),
      Math.abs(a[1] - b[1]),
      Math.abs(a[2] - b[2]),
      material,
      flags,
    )
  }

  /** Decoration: drawn, but you walk and shoot through it. */
  deco(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: MaterialId,
  ): this {
    return this.block(x, y, z, w, h, d, material, DECO)
  }

  /** A box turned about the vertical (degrees) — decoration only, since it isn't axis-aligned. */
  turned(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    deg: number,
    material: MaterialId,
    tilt = 0,
  ): this {
    this.build.boxes.push({
      center: this.world(x, y + h / 2, z),
      size: [w, h, d],
      rotation: [tilt, (deg * Math.PI) / 180 - (this.turn * Math.PI) / 2, 0],
      material,
      collide: false,
    })
    return this
  }

  /**
   * A walkable slope (stairs, gangways, ramps) along local z: its top surface starts at height
   * `y` at z = `zStart` and climbs `run` metres towards −z (or +z with `toward` = 1) at
   * `angleDeg`, `thick` metres deep. Returns the height gained.
   */
  ramp(
    x: number,
    y: number,
    zStart: number,
    width: number,
    run: number,
    angleDeg: number,
    material: MaterialId = 'wood',
    toward: -1 | 1 = -1,
    flags: BoxFlags = {},
    thick = 0.25,
  ): number {
    const a = (angleDeg * Math.PI) / 180
    const rise = run * Math.tan(a)
    const length = run / Math.cos(a)
    // Which way it climbs in the world.
    const [dx, dz] = this.rotate(0, toward)
    const top = this.world(x, y + rise / 2, zStart + (toward * run) / 2)
    const push = (Math.sin(a) * thick) / 2
    const alongX = Math.abs(dx) > 0.5
    this.build.boxes.push({
      center: [top[0] + dx * push, top[1] - (Math.cos(a) * thick) / 2, top[2] + dz * push],
      size: alongX ? [length, thick, width] : [width, thick, length],
      rotation: alongX ? [0, 0, dx * a] : [-dz * a, 0, 0],
      material,
      ...flags,
    })
    return rise
  }

  light(x: number, y: number, z: number, options: LampOptions = {}): this {
    this.build.lights.push({
      kind: 'point',
      pos: this.world(x, y, z),
      color: options.color ?? 0xffc880,
      intensity: options.intensity ?? 14,
      distance: options.distance ?? 11,
      ...(options.flicker ? { flicker: options.flicker } : {}),
    })
    return this
  }

  /**
   * A lantern on a cord from a beam or ceiling at height `ceil`, hanging `drop` metres: it
   * swings (in the wind outdoors) and its light swings with it.
   */
  lantern(x: number, ceil: number, z: number, drop = 0.55, options: LampOptions = {}): this {
    const hung: BoxFlags = { ...DECO, swing: this.build.lights.length }
    const y = ceil - drop
    this.block(x, y + 0.24, z, 0.02, drop - 0.24, 0.02, 'metal', hung)
    this.block(x, y + 0.2, z, 0.2, 0.04, 0.2, 'metal', hung)
    this.block(x, y + 0.03, z, 0.13, 0.17, 0.13, 'lantern', hung)
    this.block(x, y, z, 0.18, 0.03, 0.18, 'metal', hung)
    this.light(x, y + 0.1, z, options)
    const light = this.build.lights[this.build.lights.length - 1] as MapLight
    light.hang = drop - 0.1
    return this
  }

  /** Something to find here (lying at this height: on the floor, a table, a shelf). */
  loot(x: number, y: number, z: number, table: LootTable): this {
    this.build.loot.push({ pos: this.world(x, y, z), table, poi: this.index })
    return this
  }

  /** One of the dead stands around here. */
  zombie(x: number, z: number, y = 0): this {
    this.build.zombieSpots.push({ pos: this.world(x, y, z), poi: this.index })
    return this
  }

  npc(
    key: string,
    name: string,
    role: NpcRole,
    x: number,
    z: number,
    yawDeg: number,
    color = 0,
    y = 0,
  ): this {
    this.build.npcs.push({
      key,
      name,
      role,
      pos: this.world(x, y, z),
      yaw: this.yaw(yawDeg),
      color,
    })
    return this
  }

  interact(
    key: string,
    kind: InteractKind,
    x: number,
    y: number,
    z: number,
    label: string,
    text?: string,
  ): this {
    this.build.interactables.push({
      key,
      kind,
      pos: this.world(x, y, z),
      label,
      poi: this.index,
      ...(text ? { text } : {}),
    })
    return this
  }

  label(x: number, y: number, z: number, text: string): this {
    this.build.labels.push({ pos: this.world(x, y, z), text })
    return this
  }

  /** The inside of a building (local x/z corners) and its doors, for the dead to path through. */
  room(x0: number, z0: number, x1: number, z1: number, doors: [number, number][]): this {
    const a = this.world(x0, 0, z0)
    const b = this.world(x1, 0, z1)
    this.build.rooms.push({
      min: [Math.min(a[0], b[0]), Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), Math.max(a[2], b[2])],
      doors: doors.map(([x, z]) => this.world(x, 0, z)),
    })
    return this
  }

  /**
   * A straight wall from (x0, z0) to (x1, z1) — along x or along z — from `y` up `h`, with gaps:
   * each gap is [centre along the wall measured from its start, width, sill, top].
   */
  wall(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    h: number,
    material: MaterialId,
    gaps: [at: number, width: number, sill: number, top: number][] = [],
    flags: BoxFlags = {},
  ): this {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
    const length = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0)
    const start = alongX ? Math.min(x0, x1) : Math.min(z0, z1)
    const fixed = alongX ? z0 : x0
    const piece = (from: number, to: number, bottom: number, top: number) => {
      if (to - from < 0.02 || top - bottom < 0.02) return
      const mid = start + (from + to) / 2
      if (alongX) this.block(mid, y + bottom, fixed, to - from, top - bottom, WALL, material, flags)
      else this.block(fixed, y + bottom, mid, WALL, top - bottom, to - from, material, flags)
    }
    const sorted = [...gaps].sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [at, width, sill, top] of sorted) {
      const from = Math.max(cursor, at - width / 2)
      const to = Math.min(length, at + width / 2)
      piece(cursor, from, 0, h)
      piece(from, to, 0, sill)
      piece(from, to, Math.min(h, top), h)
      cursor = to
    }
    piece(cursor, length, 0, h)
    return this
  }

  /**
   * Four walls, a floor and (optionally) a roof, centred on (x, z), with doorways and windows.
   * The floor is a 12 cm slab on the ground. Registers the inside as a room.
   */
  shell(x: number, z: number, o: ShellOptions): this {
    const { w, d, h } = o
    const x0 = x - w / 2
    const x1 = x + w / 2
    const z0 = z - d / 2
    const z1 = z + d / 2
    const FLOOR = 0.12
    this.block(x, -0.4, z, w, 0.4 + FLOOR, d, o.floor ?? 'wood')
    const openings = [
      ...(o.doors ?? []).map((door) => ({
        ...door,
        sill: 0,
        height: door.height ?? DOOR_H,
        door: true,
      })),
      ...(o.windows ?? []).map((win) => ({
        ...win,
        sill: win.sill ?? 1,
        height: win.height ?? 1.1,
        door: false,
      })),
    ]
    const doorPoints: [number, number][] = []
    const trim = o.trim === false ? null : (o.trim ?? trimFor(o.wall))
    const outward = (side: Side) => (side === 'n' || side === 'w' ? -1 : 1)
    for (const side of ['n', 's', 'e', 'w'] as const) {
      const alongX = side === 'n' || side === 's'
      const length = alongX ? w : d
      const fixed =
        side === 'n'
          ? z0 + WALL / 2
          : side === 's'
            ? z1 - WALL / 2
            : side === 'w'
              ? x0 + WALL / 2
              : x1 - WALL / 2
      const gaps: [number, number, number, number][] = []
      for (const g of openings.filter((g) => g.side === side)) {
        const width = g.width ?? (g.door ? DOOR_W : 1.2)
        const at = length / 2 + g.at
        gaps.push([at, width, g.sill, g.sill + g.height])
        const along = (alongX ? x0 : z0) + at
        const out = side === 'n' || side === 'w' ? -1 : 1
        if (g.door || (!g.glass && !g.boards)) {
          // Doorways and open windows can be boarded up.
          const [sx, sy, sz] = alongX
            ? this.world(along, FLOOR + g.sill, fixed)
            : this.world(fixed, FLOOR + g.sill, along)
          this.build.spots.push({
            x: sx,
            y: sy,
            z: sz,
            w: width,
            h: g.height,
            alongX: alongX !== (this.turn % 2 === 1),
            door: g.door,
            poi: this.index,
          })
        }
        if (g.door) {
          doorPoints.push(alongX ? [along, fixed + out * 0.9] : [fixed + out * 0.9, along])
        } else if (g.glass) {
          if (alongX) this.block(along, FLOOR + g.sill, fixed, width, g.height, 0.04, 'glass')
          else this.block(fixed, FLOOR + g.sill, along, 0.04, g.height, width, 'glass')
        } else if (g.boards) {
          for (const [i, lift] of [0.12, 0.5, 0.85].entries()) {
            const yb = FLOOR + g.sill + g.height * lift - 0.09
            const off = out * (WALL / 2 + 0.03 + i * 0.004)
            if (alongX) this.block(along, yb, fixed + off, width + 0.3, 0.18, 0.04, 'wood')
            else this.block(fixed + off, yb, along, 0.04, 0.18, width + 0.3, 'wood')
          }
        }
      }
      if (alongX) this.wall(x0, fixed, x1, fixed, FLOOR, h, o.wall, gaps)
      else
        this.wall(
          fixed,
          z0 + WALL,
          fixed,
          z1 - WALL,
          FLOOR,
          h,
          o.wall,
          gaps.map(([at, ...rest]) => [at - WALL, ...rest]),
        )
      // After the walls, so where trim lies flush with them it's the trim that gives way.
      if (trim) {
        const holes = openings
          .filter((g) => g.side === side)
          .map((g) => ({
            along: (alongX ? x0 : z0) + length / 2 + g.at,
            width: g.width ?? (g.door ? DOOR_W : 1.2),
            sill: g.sill,
            height: g.height,
            door: g.door,
          }))
        this.trimSide(alongX, fixed, outward(side), alongX ? x0 : z0, length, h, holes, trim)
      }
    }
    if (trim) {
      // Corner posts, flush with the walls inside and standing proud of them outside.
      const post = WALL + TRIM_OUT
      for (const [cx, sx] of [
        [x0, 1],
        [x1, -1],
      ] as const) {
        for (const [cz, sz] of [
          [z0, 1],
          [z1, -1],
        ] as const) {
          const px = cx + (sx * (WALL - TRIM_OUT)) / 2
          const pz = cz + (sz * (WALL - TRIM_OUT)) / 2
          this.deco(px, FOOTING, pz, post, FLOOR + h - FOOTING, post, trim)
        }
      }
    }
    if (o.roof) {
      this.block(x, FLOOR + h, z, w + 0.5, 0.18, d + 0.5, o.roof)
      if (trim && o.roof !== 'glass' && o.roof !== 'canvas') this.eaves(x, z, w, d, h, o, trim)
      if (o.pitch) {
        // A stepped gable: slabs getting narrower towards the ridge.
        const steps = 4
        const alongX = w >= d
        for (let i = 1; i <= steps; i++) {
          const shrink = 1 - i / (steps + 0.6)
          const yb = FLOOR + h + 0.18 + ((i - 1) * o.pitch) / steps
          if (alongX) this.deco(x, yb, z, w + 0.5, o.pitch / steps, (d + 0.5) * shrink, o.roof)
          else this.deco(x, yb, z, (w + 0.5) * shrink, o.pitch / steps, d + 0.5, o.roof)
        }
      }
    }
    if (!o.noRoom) this.room(x0 + WALL, z0 + WALL, x1 - WALL, z1 - WALL, doorPoints)
    return this
  }

  /**
   * One side's dressing (see shell): a footing along its foot outside, skirting inside, and
   * frames round its doors and windows. All decoration: nothing here changes what collides.
   */
  private trimSide(
    alongX: boolean,
    fixed: number,
    out: 1 | -1,
    start: number,
    length: number,
    h: number,
    holes: { along: number; width: number; sill: number; height: number; door: boolean }[],
    trim: MaterialId,
  ): void {
    const FLOOR = 0.12
    /** A box against this wall: `off` from its centre line (outwards positive), `depth` thick. */
    const face =
      (along: number, y: number, len: number, hi: number, off: number, depth: number) =>
      (material: MaterialId) => {
        if (len < 0.02) return
        if (alongX) this.deco(along, y, fixed + out * off, len, hi, depth, material)
        else this.deco(fixed + out * off, y, along, depth, hi, len, material)
      }
    // Footing outside and skirting inside run the length of the wall, broken at the doors.
    const doors = holes.filter((g) => g.door).sort((a, b) => a.along - b.along)
    const runs = (from: number, to: number, put: (a: number, b: number) => void) => {
      let cursor = from
      for (const g of doors) {
        put(cursor, g.along - g.width / 2)
        cursor = g.along + g.width / 2
      }
      put(cursor, to)
    }
    const end = start + length
    // Along x the footing wraps the corners; along z it fits between.
    const wrap = alongX ? 0.05 : 0
    runs(start - wrap, end + wrap, (a, b) =>
      face((a + b) / 2, -0.3, b - a, FOOTING + 0.3, WALL / 2 + 0.025, 0.05)('concrete'),
    )
    runs(start + WALL, end - WALL, (a, b) =>
      face((a + b) / 2, FLOOR, b - a, 0.1, -(WALL / 2 + 0.0125), 0.025)(trim),
    )
    for (const g of holes) {
      const bottom = FLOOR + g.sill
      const top = Math.min(bottom + g.height, FLOOR + h - FRAME)
      const sides = g.door ? [1, -1] : [1]
      for (const k of sides) {
        const off = k * (WALL / 2 + TRIM_OUT / 2)
        for (const e of [-1, 1]) {
          face(
            g.along + e * (g.width / 2 + FRAME / 2),
            bottom,
            FRAME,
            top - bottom,
            off,
            TRIM_OUT,
          )(trim)
        }
        face(g.along, top, g.width + 2 * FRAME, FRAME, off, TRIM_OUT)(trim)
      }
      if (!g.door) {
        // A sill sticking out under the window, and a ledge inside.
        face(g.along, bottom - 0.06, g.width + 2 * FRAME + 0.1, 0.06, WALL / 2 + 0.06, 0.12)(trim)
        face(g.along, bottom - 0.04, g.width, 0.04, -(WALL / 2 + 0.04), 0.08)(trim)
      }
    }
  }

  /**
   * Fascia boards round a roof slab and, under a pitched roof, gutters along the eaves with
   * a downpipe down a corner each, and a cap along the ridge.
   */
  private eaves(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    o: ShellOptions,
    trim: MaterialId,
  ): void {
    const FLOOR = 0.12
    const W = w + 0.5
    const D = d + 0.5
    const y = FLOOR + h - 0.05
    const board = 0.04
    for (const e of [-1, 1]) {
      this.deco(x, y, z + e * (D / 2 + board / 2), W + 2 * board, 0.26, board, trim)
      this.deco(x + e * (W / 2 + board / 2), y, z, board, 0.26, D, trim)
    }
    if (!o.pitch) return
    const alongX = w >= d
    const run = alongX ? W : D
    for (const e of [-1, 1] as const) {
      // The gutter, just outside the fascia on the eaves' side.
      const g = (alongX ? D : W) / 2 + board + 0.06
      const gy = y - 0.02
      if (alongX) this.deco(x, gy, z + e * g, run, 0.1, 0.12, 'metal')
      else this.deco(x + e * g, gy, z, 0.12, 0.1, run, 'metal')
      // Its downpipe: across from the gutter to the wall, then down to the ground.
      const along = e * (run / 2 - 0.65)
      const wallFace = (alongX ? d : w) / 2 + 0.06
      const reach = g - wallFace
      const mid = (g + wallFace) / 2
      if (alongX) {
        this.deco(x + along, gy - 0.12, z + e * mid, 0.08, 0.1, reach, 'metal')
        this.deco(x + along, 0.05, z + e * wallFace, 0.08, gy - 0.07, 0.08, 'metal')
      } else {
        this.deco(x + e * mid, gy - 0.12, z + along, reach, 0.1, 0.08, 'metal')
        this.deco(x + e * wallFace, 0.05, z + along, 0.08, gy - 0.07, 0.08, 'metal')
      }
    }
    const ridge = FLOOR + h + 0.18 + o.pitch
    if (alongX) this.deco(x, ridge, z, W + 0.06, 0.07, 0.26, 'metal')
    else this.deco(x, ridge, z, 0.26, 0.07, D + 0.06, 'metal')
  }
}

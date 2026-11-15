import {
  CELL,
  CHUNK,
  chunkProps,
  heightAt,
  type Prop,
  PropKind,
  RoadGrid,
  type SurvivalDef,
  WORLD_HALF,
} from '@office-fps/shared'
import * as THREE from 'three'
import { boundingSphere, type GeometryData, toGeometry, transferables } from './geometry-data.ts'
import { type GroundColour, groundColour } from './ground-colour.ts'
import { detailData, detailItems } from './ground-detail.ts'

/**
 * The forest's chunk geometry as plain typed arrays: the ground, the trees (full or simplified)
 * and the little things on the ground. Nothing here touches the scene, so it runs the same on the
 * main thread and in chunk.worker.ts (which hands the arrays back without copying them); the main
 * thread only wraps them in a BufferGeometry (toGeometry).
 */

/** How much lighter a cone's rim (its branch tips) is than its colour. */
const TIPS = 1.45
const litTips = new THREE.Color()
const litTipsDark = new THREE.Color()

/** Collects flat-shaded, vertex-coloured triangles. */
export class Triangles {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly color: number[] = []
  /** Per vertex: how much it bends in the wind, and its phase (see wind.ts). */
  readonly sway: number[] = []
  /** The plant being built: where its roots are, how stiff it is, its phase. */
  private root = { y: 0, stiff: 0, phase: 0 }

  /** What comes next bends in the wind from `y` up (stiff 0 = a rock, 1 = a pine). */
  plant(y: number, stiff: number, phase: number): void {
    this.root = { y, stiff, phase }
  }

  /** @param edge colour for a and b instead (c keeps `color`: shades from one to the other) */
  tri(a: number[], b: number[], c: number[], color: THREE.Color, edge = color): void {
    const ux = (b[0] as number) - (a[0] as number)
    const uy = (b[1] as number) - (a[1] as number)
    const uz = (b[2] as number) - (a[2] as number)
    const vx = (c[0] as number) - (a[0] as number)
    const vy = (c[1] as number) - (a[1] as number)
    const vz = (c[2] as number) - (a[2] as number)
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l
    ny /= l
    nz /= l
    for (const p of [a, b, c]) {
      this.position.push(p[0] as number, p[1] as number, p[2] as number)
      this.normal.push(nx, ny, nz)
      const k = p === c ? color : edge
      this.color.push(k.r, k.g, k.b)
      const up = Math.max(0, (p[1] as number) - this.root.y) / 6
      this.sway.push(this.root.stiff * up ** 1.5, this.root.phase)
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color): void {
    this.tri(a, b, c, color)
    this.tri(a, c, d, color)
  }

  /**
   * An upright box turned `turn` (radians) about the vertical through (x, z), from `y` up `h`,
   * leaning by (lx, lz) metres at the top. `top` null leaves the top open (nobody sees it).
   */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    turn: number,
    color: THREE.Color,
    lx = 0,
    lz = 0,
    top: THREE.Color | null = color,
  ): void {
    const c = Math.cos(turn)
    const s = Math.sin(turn)
    const corner = (dx: number, dz: number, up: boolean) => [
      x + dx * c + dz * s + (up ? lx : 0),
      y + (up ? h : 0),
      z - dx * s + dz * c + (up ? lz : 0),
    ]
    const hw = w / 2
    const hd = d / 2
    const b = [
      corner(-hw, -hd, false),
      corner(hw, -hd, false),
      corner(hw, hd, false),
      corner(-hw, hd, false),
    ]
    const t = [
      corner(-hw, -hd, true),
      corner(hw, -hd, true),
      corner(hw, hd, true),
      corner(-hw, hd, true),
    ]
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      this.quad(b[j] as number[], b[i] as number[], t[i] as number[], t[j] as number[], color)
    }
    if (top) this.quad(t[0] as number[], t[3] as number[], t[2] as number[], t[1] as number[], top)
  }

  /** A four-sided pyramid: base half-width `r` at height `y`, tip `h` above it. */
  cone(
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    turn: number,
    color: THREE.Color,
    dark: THREE.Color,
    base = true,
  ): void {
    const tip = [x, y + h, z]
    const rim: number[][] = []
    for (let i = 0; i < 4; i++) {
      const a = turn + (i * Math.PI) / 2
      rim.push([x + Math.cos(a) * r, y, z - Math.sin(a) * r])
    }
    // The branch tips round the rim catch more light than the inside of the tree.
    const lit = litTips.copy(color).multiplyScalar(TIPS)
    const litDark = litTipsDark.copy(dark).multiplyScalar(TIPS)
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0
      this.tri(
        rim[i] as number[],
        rim[(i + 1) % 4] as number[],
        tip,
        side ? color : dark,
        side ? lit : litDark,
      )
    }
    if (!base) return
    this.quad(rim[0] as number[], rim[3] as number[], rim[2] as number[], rim[1] as number[], dark)
  }

  /** @param sway keep the wind attribute (still, distant trees don't need it) */
  data(sway = true): GeometryData {
    const attributes: GeometryData['attributes'] = [
      { name: 'position', array: new Float32Array(this.position), itemSize: 3 },
      { name: 'normal', array: new Float32Array(this.normal), itemSize: 3 },
      { name: 'color', array: new Float32Array(this.color), itemSize: 3 },
    ]
    if (sway) attributes.push({ name: 'sway', array: new Float32Array(this.sway), itemSize: 2 })
    return { attributes, index: null, sphere: null }
  }

  /** @param sway keep the wind attribute (still, distant trees don't need it) */
  build(sway = true): THREE.BufferGeometry {
    return toGeometry(this.data(sway))
  }
}

export const col = (hex: number) => new THREE.Color(hex)

/** How much each kind of plant gives in the wind (rocks and logs not at all). */
const STIFFNESS: Partial<Record<PropKind, number>> = {
  [PropKind.Pine]: 0.8,
  [PropKind.Birch]: 1,
  [PropKind.DeadTree]: 0.45,
  [PropKind.Bush]: 1.6,
  [PropKind.Fern]: 3,
}

export const BARK = col(0x4a3725)
export const BARK_DARK = col(0x35261a)
export const NEEDLES = [col(0x1c3520), col(0x22402a), col(0x17301c), col(0x2a4526)]
export const NEEDLES_DARK = [col(0x122416), col(0x162c1c), col(0x0f2012), col(0x1c3019)]
export const DEAD = col(0x4a443c)
export const BIRCH = col(0xb9b6a8)
export const BIRCH_LEAF = col(0x4a5a22)
const ROCK = col(0x4f5356)
const ROCK_TOP = col(0x5d6266)
const STUMP_TOP = col(0x7a6444)
const BUSH = [col(0x1f3a1c), col(0x2a4a22)]
const FERN = col(0x35592a)

/**
 * Trees past NEAR: a pine is a trunk and two open cones (16 triangles instead of 28), a birch a
 * trunk and one block of leaves; undergrowth, stumps and logs are left out. Built without the
 * wind (nobody sees a tree sway 150 m away).
 */
function simpleProps(items: readonly Prop[]): Triangles {
  const tris = new Triangles()
  for (const p of items) {
    const turn = p.turn * Math.PI * 2
    const s = p.scale
    const pick = Math.floor(p.turn * 4) % 4
    switch (p.kind) {
      case PropKind.Pine: {
        const green = NEEDLES[pick] as THREE.Color
        const dark = NEEDLES_DARK[pick] as THREE.Color
        tris.box(p.x, p.y - 0.3, p.z, 0.36 * s, 2.2 * s, 0.36 * s, turn, BARK, 0, 0, null)
        tris.cone(p.x, p.y + 1.5 * s, p.z, 2 * s, 3.6 * s, turn, green, dark, false)
        tris.cone(p.x, p.y + 3.7 * s, p.z, 1.35 * s, 3.1 * s, turn + 0.6, green, dark, false)
        break
      }
      case PropKind.DeadTree: {
        const lean = (p.turn - 0.5) * 1.2
        tris.box(
          p.x,
          p.y - 0.3,
          p.z,
          0.32 * s,
          5.4 * s,
          0.32 * s,
          turn,
          DEAD,
          lean,
          lean * 0.5,
          null,
        )
        const h = 3.5 * s
        tris.box(
          p.x + lean * 0.65,
          p.y + h,
          p.z,
          0.12 * s,
          1.5 * s,
          0.12 * s,
          turn,
          DEAD,
          Math.cos(turn) * 1.1 * s,
          -Math.sin(turn) * 1.1 * s,
          null,
        )
        break
      }
      case PropKind.Birch:
        tris.box(
          p.x,
          p.y - 0.3,
          p.z,
          0.2 * s,
          4 * s,
          0.2 * s,
          turn,
          BIRCH,
          (p.turn - 0.5) * 0.36,
          0,
          null,
        )
        tris.box(p.x + 0.2 * s, p.y + 3.4 * s, p.z, 1.6 * s, 2.3 * s, 1.5 * s, turn, BIRCH_LEAF)
        break
      case PropKind.Rock:
        tris.box(
          p.x,
          p.y - 0.25,
          p.z,
          1.5 * s,
          1.15 * s,
          1.3 * s,
          turn,
          ROCK,
          0.15 * s,
          -0.1 * s,
          ROCK_TOP,
        )
        break
    }
  }
  return tris
}

/** Trees and undergrowth near you: every bush and fern, bending in the wind. */
function fullProps(items: readonly Prop[]): Triangles {
  const tris = new Triangles()
  for (const p of items) {
    const turn = p.turn * Math.PI * 2
    const s = p.scale
    const pick = Math.floor(p.turn * 4) % 4
    // Trees bend from the roots; the wave rolls across the forest with the wind.
    tris.plant(p.y, STIFFNESS[p.kind] ?? 0, p.x * 0.11 + p.z * 0.08 + p.turn * 6)
    switch (p.kind) {
      case PropKind.Pine: {
        tris.box(p.x, p.y - 0.3, p.z, 0.36 * s, 2.6 * s, 0.36 * s, turn, BARK, 0, 0, BARK_DARK)
        const green = NEEDLES[pick] as THREE.Color
        const dark = NEEDLES_DARK[pick] as THREE.Color
        tris.cone(p.x, p.y + 1.5 * s, p.z, 2 * s, 2.7 * s, turn, green, dark)
        tris.cone(p.x, p.y + 3.1 * s, p.z, 1.55 * s, 2.4 * s, turn + 0.6, green, dark)
        tris.cone(p.x, p.y + 4.6 * s, p.z, 1.05 * s, 2.2 * s, turn + 1.2, green, dark)
        break
      }
      case PropKind.DeadTree: {
        const lean = (p.turn - 0.5) * 1.2
        tris.box(
          p.x,
          p.y - 0.3,
          p.z,
          0.32 * s,
          5.4 * s,
          0.32 * s,
          turn,
          DEAD,
          lean,
          lean * 0.5,
          BARK_DARK,
        )
        // Bare branches reaching out.
        for (let b = 0; b < 3; b++) {
          const a = turn + b * 2.2
          const h = (2.4 + b * 1.1) * s
          const bx = p.x + (lean * h) / (5.4 * s)
          tris.box(
            bx,
            p.y + h,
            p.z,
            0.1 * s,
            1.5 * s,
            0.1 * s,
            a,
            DEAD,
            Math.cos(a) * 1.1 * s,
            -Math.sin(a) * 1.1 * s,
          )
        }
        break
      }
      case PropKind.Birch: {
        tris.box(
          p.x,
          p.y - 0.3,
          p.z,
          0.2 * s,
          5.6 * s,
          0.2 * s,
          turn,
          BIRCH,
          (p.turn - 0.5) * 0.5,
          0,
        )
        tris.box(p.x, p.y + 3.4 * s, p.z, 1.6 * s, 1.3 * s, 1.5 * s, turn, BIRCH_LEAF)
        tris.box(
          p.x + 0.4 * s,
          p.y + 4.6 * s,
          p.z,
          1.1 * s,
          1.1 * s,
          1.2 * s,
          turn + 0.7,
          BIRCH_LEAF,
        )
        break
      }
      case PropKind.Rock:
        tris.box(
          p.x,
          p.y - 0.25,
          p.z,
          1.5 * s,
          1.15 * s,
          1.3 * s,
          turn,
          ROCK,
          0.15 * s,
          -0.1 * s,
          ROCK_TOP,
        )
        break
      case PropKind.Stump:
        tris.box(p.x, p.y - 0.1, p.z, 0.62 * s, 0.55, 0.62 * s, turn, BARK, 0, 0, STUMP_TOP)
        break
      case PropKind.Bush:
        tris.box(
          p.x,
          p.y - 0.1,
          p.z,
          1.3 * s,
          0.8 * s,
          1.1 * s,
          turn,
          BUSH[pick % 2] as THREE.Color,
        )
        tris.box(
          p.x + 0.3 * s,
          p.y + 0.3,
          p.z + 0.2 * s,
          0.8 * s,
          0.8 * s,
          0.9 * s,
          turn + 0.8,
          BUSH[(pick + 1) % 2] as THREE.Color,
        )
        break
      case PropKind.Fern:
        tris.cone(p.x, p.y - 0.05, p.z, 0.5 * s, 0.45 * s, turn, FERN, BUSH[0] as THREE.Color)
        break
      case PropKind.Log:
        tris.box(p.x, p.y - 0.08, p.z, 0.42 * s, 0.4 * s, 2.8 * s, turn, BARK, 0, 0, BARK_DARK)
        break
    }
  }
  return tris
}
// --- Chunks -------------------------------------------------------------------------------

/** How a chunk's trees are drawn: in full, or simplified (see wilds.ts). */
export const Detail = { Full: 0, Simple: 1 } as const
export type Detail = (typeof Detail)[keyof typeof Detail]

/** The trees of a chunk at a level of detail. */
export function propsData(items: readonly Prop[], level: Detail): GeometryData {
  const data = level === Detail.Simple ? simpleProps(items).data(false) : fullProps(items).data()
  data.sphere = boundingSphere(data.attributes[0]?.array as Float32Array)
  return data
}

/** What the chunk builders need of the world (all of it deterministic, from the seed). */
export type ChunkWorld = Pick<SurvivalDef, 'seed' | 'terrain' | 'pois' | 'roads' | 'lakes'>

/** The ground of chunk (cx, cz): a CELL grid of heights, slope normals and blended colours. */
export function groundData(world: ChunkWorld, cx: number, cz: number): GeometryData {
  const t = world.terrain
  const x0 = cx * CHUNK - WORLD_HALF
  const z0 = cz * CHUNK - WORLD_HALF
  const cells = CHUNK / CELL
  const n = cells + 1
  const position = new Float32Array(n * n * 3)
  const normal = new Float32Array(n * n * 3)
  const color = new Float32Array(n * n * 3)
  const uv = new Float32Array(n * n * 2)
  const mud = new Float32Array(n * n)
  const ground: GroundColour = { r: 0, g: 0, b: 0, mud: 0 }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = x0 + i * CELL
      const z = z0 + j * CELL
      const k = i * n + j
      const y = heightAt(t, x, z)
      position.set([x, y, z], k * 3)
      // Smooth normals from the slope around the vertex.
      const dx = heightAt(t, x + CELL, z) - heightAt(t, x - CELL, z)
      const dz = heightAt(t, x, z + CELL) - heightAt(t, x, z - CELL)
      const l = Math.hypot(dx, 2 * CELL, dz)
      normal.set([-dx / l, (2 * CELL) / l, -dz / l], k * 3)
      // Blended surfaces, patches and mud (ground-colour.ts).
      groundColour(t, world.lakes, x, z, ground)
      color.set([ground.r, ground.g, ground.b], k * 3)
      mud[k] = ground.mud
      uv.set([x / 6, z / 6], k * 2)
    }
  }
  const index = new Uint16Array(cells * cells * 6)
  let w = 0
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const a = i * n + j
      const b = a + 1
      const c = a + n
      const d = c + 1
      // Split along the same diagonal as the physics heightfield: (x+1, z) – (x, z+1).
      index.set([a, b, c, c, b, d], w)
      w += 6
    }
  }
  return {
    attributes: [
      { name: 'position', array: position, itemSize: 3 },
      { name: 'normal', array: normal, itemSize: 3 },
      { name: 'color', array: color, itemSize: 3 },
      { name: 'uv', array: uv, itemSize: 2 },
      { name: 'mud', array: mud, itemSize: 1 },
    ],
    index,
    sphere: boundingSphere(position),
  }
}

/** Work for a chunk builder: a whole chunk, a chunk's trees at another detail, or its ground detail. */
export type ChunkJob =
  | { kind: 'chunk'; cx: number; cz: number; level: Detail }
  | { kind: 'props'; cx: number; cz: number; level: Detail }
  /** `density` 0–1: how much of the small stuff (grass, pebbles…) is kept. */
  | { kind: 'detail'; cx: number; cz: number; density: number }

export type ChunkResult =
  | {
      kind: 'chunk'
      cx: number
      cz: number
      level: Detail
      ground: GeometryData
      props: GeometryData
      items: Prop[]
    }
  | { kind: 'props'; cx: number; cz: number; level: Detail; props: GeometryData }
  | {
      kind: 'detail'
      cx: number
      cz: number
      density: number
      main: GeometryData | null
      glow: GeometryData | null
    }

/** Builds chunk geometry for one world (the same on either thread). */
export class ChunkMaker {
  private readonly world: ChunkWorld
  private readonly roads: RoadGrid

  constructor(world: ChunkWorld) {
    this.world = world
    this.roads = new RoadGrid(world.roads)
  }

  make(job: ChunkJob): ChunkResult {
    const { seed, terrain } = this.world
    switch (job.kind) {
      case 'chunk': {
        const items = chunkProps(terrain, seed, job.cx, job.cz)
        return {
          ...job,
          ground: groundData(this.world, job.cx, job.cz),
          props: propsData(items, job.level),
          items,
        }
      }
      case 'props':
        return { ...job, props: propsData(chunkProps(terrain, seed, job.cx, job.cz), job.level) }
      case 'detail': {
        const items = detailItems(this.world, this.roads, job.cx, job.cz, job.density)
        return { ...job, ...detailData(terrain, items) }
      }
    }
  }
}

/** Every buffer in a result (to transfer it). */
export function resultBuffers(r: ChunkResult): ArrayBuffer[] {
  switch (r.kind) {
    case 'chunk':
      return [...transferables(r.ground), ...transferables(r.props)]
    case 'props':
      return transferables(r.props)
    case 'detail':
      return [...transferables(r.main), ...transferables(r.glow)]
  }
}

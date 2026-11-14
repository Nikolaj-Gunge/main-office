import {
  CHUNK,
  chunkProps,
  coverAt,
  hash2,
  heightAt,
  PropKind,
  type RoadGrid,
  Surface,
  type SurvivalDef,
  seeded,
  surfaceAt,
  WORLD_HALF,
} from '@office-fps/shared'
import * as THREE from 'three'
import { SWAY_VERTEX, windUniforms } from './wind.ts'

/**
 * The little things on the forest floor, drawn only around the viewer: grass, twigs and fallen
 * branches, leaf litter, pebbles, moss, ferns, mushrooms (a few faintly glowing), and now and
 * then a bone or somebody's shoe. Visual only and client-side: nothing here is solid, and it is
 * all generated from the world seed, the same every time.
 */

export const DetailKind = {
  Grass: 0,
  Clump: 1,
  Twig: 2,
  Branch: 3,
  Litter: 4,
  Pebbles: 5,
  Mushrooms: 6,
  Moss: 7,
  Fern: 8,
  Flowers: 9,
  Bones: 10,
  Skull: 11,
  Shoe: 12,
  Fence: 13,
} as const
export type DetailKind = (typeof DetailKind)[keyof typeof DetailKind]

export interface DetailItem {
  kind: DetailKind
  x: number
  y: number
  z: number
  /** About 0.6–1.4. */
  scale: number
  /** Turn, 0–1 of a full circle. */
  turn: number
  /** Mushrooms: these ones glow. */
  glow?: boolean
}

/** One candidate spot every STEP metres (jittered). */
const STEP = 1.6
const CELLS = Math.round(CHUNK / STEP)

/** How likely each kind is at a spot, in the open (cover 0) and deep in the forest (cover 1). */
const ODDS: [DetailKind, number, number][] = [
  [DetailKind.Grass, 0.36, 0.1],
  [DetailKind.Clump, 0.16, 0.015],
  [DetailKind.Flowers, 0.04, 0],
  [DetailKind.Twig, 0.012, 0.08],
  [DetailKind.Branch, 0.002, 0.012],
  [DetailKind.Litter, 0.006, 0.07],
  [DetailKind.Pebbles, 0.025, 0.025],
  [DetailKind.Mushrooms, 0.001, 0.012],
  [DetailKind.Moss, 0.004, 0.05],
  [DetailKind.Fern, 0.006, 0.06],
  [DetailKind.Bones, 0.0004, 0.0009],
  [DetailKind.Skull, 0.0001, 0.0003],
  [DetailKind.Shoe, 0.0002, 0.0003],
  [DetailKind.Fence, 0.0012, 0],
]

/**
 * What lies on the ground in one chunk: never on a road, in a lake or on the flat ground of a
 * place (where the buildings stand); thicker in the forest, grassier in the open.
 */
export function detailItems(
  def: SurvivalDef,
  roads: RoadGrid,
  cx: number,
  cz: number,
): DetailItem[] {
  const t = def.terrain
  const out: DetailItem[] = []
  const random = seeded(Math.floor(hash2(cx, cz, def.seed + 911) * 0xffffffff))
  const x0 = cx * CHUNK - WORLD_HALF
  const z0 = cz * CHUNK - WORLD_HALF
  // Only the places and lakes near this chunk matter.
  const pois = def.pois.filter(
    (p) =>
      Math.abs(p.x - (x0 + CHUNK / 2)) < p.r + CHUNK &&
      Math.abs(p.z - (z0 + CHUNK / 2)) < p.r + CHUNK,
  )
  const lakes = def.lakes.filter(
    (l) =>
      Math.abs(l.x - (x0 + CHUNK / 2)) < l.r + 40 + CHUNK &&
      Math.abs(l.z - (z0 + CHUNK / 2)) < l.r + 40 + CHUNK,
  )
  for (let i = 0; i < CELLS; i++) {
    for (let j = 0; j < CELLS; j++) {
      // Always the same number of draws per spot, kept or not.
      const x = x0 + (i + random()) * STEP
      const z = z0 + (j + random()) * STEP
      const roll = random()
      const scale = 0.6 + random() * 0.8
      const turn = random()
      const extra = random()
      if (pois.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + 1) ** 2)) continue
      const y = heightAt(t, x, z)
      if (lakes.some((l) => y < l.y + 0.2 && (l.x - x) ** 2 + (l.z - z) ** 2 < (l.r + 32) ** 2))
        continue
      const edge = roads.edgeDistance(x, z)
      if (edge < 0.4) continue
      const surface = surfaceAt(t, x, z)
      const cover = coverAt(t, x, z)
      // On the verge: grass and gravel; on bare ground (clearing edges, shores) much less.
      const verge = edge < 3
      const sparse = verge ? 0.6 : surface === Surface.Dirt || surface === Surface.Sand ? 0.25 : 1
      let acc = 0
      let kind: DetailKind | null = null
      for (const [k, open, forest] of ODDS) {
        let p = open + (forest - open) * cover
        if (verge && (k === DetailKind.Grass || k === DetailKind.Pebbles)) p *= 2
        if (verge && k === DetailKind.Fence) p = 0
        acc += p * sparse
        if (roll < acc) {
          kind = k
          break
        }
      }
      if (kind === null) continue
      out.push({
        kind,
        x,
        y,
        z,
        scale,
        turn,
        ...(kind === DetailKind.Mushrooms && extra < 0.08 ? { glow: true } : {}),
      })
    }
  }
  // Moss on the rocks and stumps, mushrooms at the foot of some trees and on the logs.
  for (const p of chunkProps(t, def.seed, cx, cz)) {
    const r = hash2(Math.floor(p.x * 7), Math.floor(p.z * 7), def.seed + 913)
    if (p.kind === PropKind.Rock || p.kind === PropKind.Stump) {
      out.push({
        kind: DetailKind.Moss,
        x: p.x,
        y: p.y,
        z: p.z,
        scale: p.scale * 1.3,
        turn: p.turn,
      })
    } else if ((p.kind === PropKind.Log || p.kind === PropKind.DeadTree) && r < 0.6) {
      out.push({
        kind: DetailKind.Mushrooms,
        x: p.x + 0.35,
        y: p.y,
        z: p.z + 0.2,
        scale: 1.1,
        turn: r,
        ...(r < 0.1 ? { glow: true } : {}),
      })
    } else if (p.kind === PropKind.Pine && r < 0.06) {
      out.push({
        kind: DetailKind.Mushrooms,
        x: p.x + 0.4,
        y: p.y,
        z: p.z - 0.3,
        scale: 0.9,
        turn: r,
        ...(r < 0.008 ? { glow: true } : {}),
      })
    }
  }
  return out
}

const col = (hex: number) => new THREE.Color(hex)
const GRASS = [col(0x284018), col(0x30461b), col(0x3a4a1f), col(0x444828), col(0x213616)]
const GRASS_DRY = [col(0x58502e), col(0x4c4a2a)]
const LEAVES = [col(0x4a3218), col(0x5a3c1c), col(0x3e2a16), col(0x64481e), col(0x4e2a16)]
const LITTER = col(0x2e2416)
const TWIG = [col(0x3a2c20), col(0x4a3a2a), col(0x2e241a)]
const STONE = [col(0x55585a), col(0x606366), col(0x4a4c4e), col(0x6a675f)]
const MOSS = [col(0x2a3c15), col(0x31461a), col(0x253512)]
const FERN = [col(0x223a18), col(0x1e3416), col(0x28401c)]
const FLOWER = [col(0xc8c2a0), col(0x9a86b0), col(0xc8b450)]
const STEM = col(0xc8bca0)
const CAP = [col(0x8a4a2a), col(0x6a4a30), col(0xa8823c)]
// Faint: a soft blue-green, not neon (unlit, so they stand out at night whatever their colour).
const GLOW = [col(0x3f8a7a), col(0x4f8a62), col(0x4a7890)]
const BONE = col(0xc9c2ad)
const BONE_DARK = col(0x8f8774)
const SHOE = col(0x2a2622)
const SOLE = col(0x5a5048)
const POST = [col(0x4a4032), col(0x3e362a)]

/** Flat-shaded triangles with wind sway and an anchor each (what they shrink to far away). */
class DetailMesh {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly color: number[] = []
  readonly sway: number[] = []
  readonly anchor: number[] = []
  private ax = 0
  private ay = 0
  private az = 0
  private phase = 0
  /** Sway per metre above the anchor. */
  private give = 0

  /** What follows belongs to a thing standing at (x, y, z), bending `give` per metre up. */
  at(x: number, y: number, z: number, give: number, phase: number): void {
    this.ax = x
    this.ay = y
    this.az = z
    this.give = give
    this.phase = phase
  }

  /** A triangle; `up` gives it an upward normal (grass lit like the ground, not edge-on). */
  tri(a: number[], b: number[], c: number[], color: THREE.Color, up = false): void {
    let nx = 0
    let ny = 1
    let nz = 0
    if (!up) {
      const ux = (b[0] as number) - (a[0] as number)
      const uy = (b[1] as number) - (a[1] as number)
      const uz = (b[2] as number) - (a[2] as number)
      const vx = (c[0] as number) - (a[0] as number)
      const vy = (c[1] as number) - (a[1] as number)
      const vz = (c[2] as number) - (a[2] as number)
      nx = uy * vz - uz * vy
      ny = uz * vx - ux * vz
      nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l
      ny /= l
      nz /= l
    }
    for (const p of [a, b, c]) {
      this.position.push(p[0] as number, p[1] as number, p[2] as number)
      this.normal.push(nx, ny, nz)
      this.color.push(color.r, color.g, color.b)
      this.sway.push(Math.max(0, (p[1] as number) - this.ay) * this.give, this.phase)
      this.anchor.push(this.ax, this.ay, this.az)
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color, up = false): void {
    this.tri(a, b, c, color, up)
    this.tri(a, c, d, color, up)
  }

  /** A lying stick from a to b: a ridge of two slanted faces. */
  stick(a: number[], b: number[], r: number, color: THREE.Color): void {
    const dx = (b[0] as number) - (a[0] as number)
    const dz = (b[2] as number) - (a[2] as number)
    const l = Math.hypot(dx, dz) || 1
    const px = (-dz / l) * r
    const pz = (dx / l) * r
    const top = (p: number[]) => [p[0] as number, (p[1] as number) + r, p[2] as number]
    const left = (p: number[]) => [(p[0] as number) - px, p[1] as number, (p[2] as number) - pz]
    const right = (p: number[]) => [(p[0] as number) + px, p[1] as number, (p[2] as number) + pz]
    this.quad(left(a), left(b), top(b), top(a), color)
    this.quad(top(a), top(b), right(b), right(a), color)
  }

  /** A low four-sided pyramid (a stone, a cap); `r` half-width, `h` high. */
  nub(
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    turn: number,
    color: THREE.Color,
    dark = color,
  ): void {
    const tip = [x, y + h, z]
    const base: number[][] = []
    for (let i = 0; i < 4; i++) {
      const a = turn + (i * Math.PI) / 2
      base.push([x + Math.cos(a) * r, y, z - Math.sin(a) * r])
    }
    for (let i = 0; i < 4; i++)
      this.tri(base[i] as number[], base[(i + 1) % 4] as number[], tip, i % 2 ? dark : color)
  }

  /** An upright box (stems, posts, skulls), no bottom. */
  block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    turn: number,
    color: THREE.Color,
    top = color,
    lx = 0,
    lz = 0,
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
    this.quad(t[0] as number[], t[3] as number[], t[2] as number[], t[1] as number[], top)
  }

  /** A flat patch hugging the ground: an irregular fan of `n` triangles. */
  patch(
    terrain: SurvivalDef['terrain'],
    x: number,
    z: number,
    r: number,
    n: number,
    seed: number,
    color: THREE.Color,
    lift = 0.025,
  ): void {
    const centre = [x, heightAt(terrain, x, z) + lift, z]
    const rim: number[][] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = r * (0.65 + hash2(i, seed, 917) * 0.5)
      const px = x + Math.cos(a) * rr
      const pz = z - Math.sin(a) * rr
      rim.push([px, heightAt(terrain, px, pz) + lift, pz])
    }
    for (let i = 0; i < n; i++)
      this.tri(centre, rim[i] as number[], rim[(i + 1) % n] as number[], color, true)
  }

  get empty(): boolean {
    return this.position.length === 0
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 2))
    g.setAttribute('anchor', new THREE.Float32BufferAttribute(this.anchor, 3))
    g.computeBoundingSphere()
    return g
  }
}

const pick = <T>(list: readonly T[], r: number): T =>
  list[Math.floor(r * list.length) % list.length] as T

/** Builds the meshes' geometry for a chunk's items: the lit things, and the glowing caps. */
export function buildDetail(
  terrain: SurvivalDef['terrain'],
  items: readonly DetailItem[],
): { main: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const m = new DetailMesh()
  const g = new DetailMesh()
  for (const it of items) {
    const { x, y, z, scale: s } = it
    const turn = it.turn * Math.PI * 2
    const r = (k: number) => hash2(Math.floor(x * 31) + k, Math.floor(z * 31), 919)
    const phase = x * 0.11 + z * 0.08 + it.turn * 6
    switch (it.kind) {
      case DetailKind.Grass:
      case DetailKind.Clump: {
        const clump = it.kind === DetailKind.Clump
        const blades = clump ? 9 : 5
        const tall = (clump ? 0.75 : 0.42) * s
        m.at(x, y, z, 0.6, phase)
        const dry = r(1) < 0.25
        for (let b = 0; b < blades; b++) {
          const a = turn + (b * Math.PI * 2) / blades + r(b) * 0.6
          const h = tall * (0.55 + r(b + 9) * 0.6)
          const lean = h * (0.25 + r(b + 3) * 0.35)
          const bx = x + Math.cos(a) * 0.06 * s
          const bz = z - Math.sin(a) * 0.06 * s
          const w = 0.035 + r(b + 5) * 0.03
          const tip = [bx + Math.cos(a) * lean, y + h, bz - Math.sin(a) * lean]
          const px = Math.sin(a) * w
          const pz = Math.cos(a) * w
          const color = dry ? pick(GRASS_DRY, r(b + 7)) : pick(GRASS, r(b + 7))
          m.tri([bx - px, y - 0.02, bz - pz], [bx + px, y - 0.02, bz + pz], tip, color, true)
        }
        break
      }
      case DetailKind.Flowers: {
        m.at(x, y, z, 0.5, phase)
        const color = pick(FLOWER, r(2))
        for (let b = 0; b < 4; b++) {
          const a = turn + b * 1.7
          const fx = x + Math.cos(a) * 0.18 * s
          const fz = z - Math.sin(a) * 0.18 * s
          const h = (0.22 + r(b) * 0.18) * s
          m.tri(
            [fx - 0.015, y, fz],
            [fx + 0.015, y, fz],
            [fx, y + h, fz],
            GRASS[0] as THREE.Color,
            true,
          )
          m.nub(fx, y + h - 0.02, fz, 0.045, 0.04, a, color)
        }
        break
      }
      case DetailKind.Twig: {
        m.at(x, y, z, 0, 0)
        const l = (0.35 + r(1) * 0.5) * s
        const ex = x + Math.cos(turn) * l
        const ez = z - Math.sin(turn) * l
        m.stick(
          [x, y + 0.01, z],
          [ex, heightAt(terrain, ex, ez) + 0.01, ez],
          0.025,
          pick(TWIG, r(2)),
        )
        break
      }
      case DetailKind.Branch: {
        m.at(x, y, z, 0, 0)
        const l = (1.4 + r(1) * 1.4) * s
        const ex = x + Math.cos(turn) * l
        const ez = z - Math.sin(turn) * l
        const color = pick(TWIG, r(2))
        m.stick([x, y + 0.02, z], [ex, heightAt(terrain, ex, ez) + 0.02, ez], 0.06, color)
        for (let b = 0; b < 3; b++) {
          const f = 0.25 + b * 0.25
          const bx = x + (ex - x) * f
          const bz = z + (ez - z) * f
          const a = turn + (b % 2 ? 0.7 : -0.7)
          const bl = (0.3 + r(b + 3) * 0.4) * s
          const tx = bx + Math.cos(a) * bl
          const tz = bz - Math.sin(a) * bl
          m.stick(
            [bx, heightAt(terrain, bx, bz) + 0.05, bz],
            [tx, heightAt(terrain, tx, tz) + 0.12, tz],
            0.025,
            color,
          )
        }
        break
      }
      case DetailKind.Litter: {
        m.at(x, y, z, 0, 0)
        m.patch(terrain, x, z, (0.5 + r(1) * 0.7) * s, 7, Math.floor(x * 13 + z * 7), LITTER, 0.02)
        for (let b = 0; b < 6; b++) {
          const a = turn + b * 1.1
          const d = r(b) * 0.8 * s
          const lx = x + Math.cos(a) * d
          const lz = z - Math.sin(a) * d
          const ly = heightAt(terrain, lx, lz) + 0.03
          const k = 0.07 + r(b + 4) * 0.05
          const c = Math.cos(a * 3)
          const sn = Math.sin(a * 3)
          m.quad(
            [lx - c * k, ly, lz + sn * k],
            [lx + sn * k, ly + 0.01, lz + c * k],
            [lx + c * k, ly, lz - sn * k],
            [lx - sn * k, ly + 0.01, lz - c * k],
            pick(LEAVES, r(b + 8)),
            true,
          )
        }
        break
      }
      case DetailKind.Pebbles: {
        m.at(x, y, z, 0, 0)
        const n = 2 + Math.floor(r(1) * 4)
        for (let b = 0; b < n; b++) {
          const a = turn + b * 2.1
          const d = r(b) * 0.4 * s
          const px = x + Math.cos(a) * d
          const pz = z - Math.sin(a) * d
          const k = (0.05 + r(b + 3) * 0.1) * s
          const color = pick(STONE, r(b + 5))
          m.nub(
            px,
            heightAt(terrain, px, pz) - 0.02,
            pz,
            k,
            k * 0.9,
            a,
            color,
            STONE[2] as THREE.Color,
          )
        }
        break
      }
      case DetailKind.Mushrooms: {
        const n = 2 + Math.floor(r(1) * 4)
        for (let b = 0; b < n; b++) {
          const a = turn + b * 2.4
          const d = 0.08 + r(b) * 0.3
          const px = x + Math.cos(a) * d
          const pz = z - Math.sin(a) * d
          const py = heightAt(terrain, px, pz)
          const h = (0.06 + r(b + 2) * 0.1) * s
          const cap = (0.05 + r(b + 4) * 0.06) * s
          m.at(px, py, pz, 0, 0)
          m.block(px, py - 0.01, pz, 0.025, h, 0.025, a, STEM)
          if (it.glow) {
            g.at(px, py, pz, 0, 0)
            g.nub(px, py + h - 0.01, pz, cap, cap * 0.7, a, pick(GLOW, r(b + 6)))
          } else m.nub(px, py + h - 0.01, pz, cap, cap * 0.7, a, pick(CAP, r(b + 6)))
        }
        break
      }
      case DetailKind.Moss: {
        m.at(x, y, z, 0, 0)
        m.patch(
          terrain,
          x,
          z,
          (0.6 + r(1) * 0.6) * s,
          6,
          Math.floor(x * 11 + z * 5),
          pick(MOSS, r(2)),
          0.03,
        )
        break
      }
      case DetailKind.Fern: {
        m.at(x, y, z, 0.35, phase)
        const fronds = 6
        const color = pick(FERN, r(1))
        for (let b = 0; b < fronds; b++) {
          const a = turn + (b * Math.PI * 2) / fronds + r(b) * 0.4
          const l = (0.55 + r(b + 2) * 0.35) * s
          const c = Math.cos(a)
          const sn = -Math.sin(a)
          const mid = [x + c * l * 0.5, y + 0.32 * s, z + sn * l * 0.5]
          const tip = [x + c * l, y + 0.12 * s, z + sn * l]
          const w = 0.11 * s
          m.quad(
            [x, y + 0.02, z],
            [(mid[0] as number) - sn * w, mid[1] as number, (mid[2] as number) + c * w],
            tip,
            [(mid[0] as number) + sn * w, mid[1] as number, (mid[2] as number) - c * w],
            color,
            true,
          )
        }
        break
      }
      case DetailKind.Bones: {
        m.at(x, y, z, 0, 0)
        for (let b = 0; b < 3; b++) {
          const a = turn + b * 1.3
          const bx = x + r(b) * 0.5
          const bz = z + r(b + 3) * 0.5
          const l = 0.3 + r(b + 5) * 0.2
          const ex = bx + Math.cos(a) * l
          const ez = bz - Math.sin(a) * l
          const by = heightAt(terrain, bx, bz) + 0.01
          m.stick([bx, by, bz], [ex, heightAt(terrain, ex, ez) + 0.01, ez], 0.03, BONE)
          m.nub(bx, by - 0.01, bz, 0.04, 0.05, a, BONE, BONE_DARK)
          m.nub(ex, by - 0.01, ez, 0.04, 0.05, a, BONE, BONE_DARK)
        }
        break
      }
      case DetailKind.Skull: {
        m.at(x, y, z, 0, 0)
        m.block(x, y - 0.03, z, 0.17, 0.17, 0.2, turn, BONE, BONE)
        // Two dark eye holes and a nose on the front.
        const fx = Math.sin(turn) * 0.101
        const fz = Math.cos(turn) * 0.101
        const sx = Math.cos(turn) * 0.04
        const sz = -Math.sin(turn) * 0.04
        for (const side of [-1, 1])
          m.block(x + fx + sx * side, y + 0.05, z + fz + sz * side, 0.045, 0.04, 0.012, turn, SHOE)
        m.block(x + fx, y + 0.005, z + fz, 0.02, 0.03, 0.012, turn, SHOE)
        break
      }
      case DetailKind.Shoe: {
        m.at(x, y, z, 0, 0)
        m.block(x, y - 0.01, z, 0.11, 0.035, 0.29, turn, SOLE)
        m.block(
          x,
          y + 0.02,
          z,
          0.1,
          0.08,
          0.26,
          turn,
          SHOE,
          SHOE,
          Math.sin(turn) * 0.02,
          Math.cos(turn) * 0.02,
        )
        break
      }
      case DetailKind.Fence: {
        // What is left of a fence: a few leaning posts, one rail still hanging on.
        const n = 3 + Math.floor(r(1) * 4)
        let prev: number[] | null = null
        for (let b = 0; b < n; b++) {
          const px = x + Math.cos(turn) * b * 2.4
          const pz = z - Math.sin(turn) * b * 2.4
          if (r(b + 2) < 0.2) {
            prev = null
            continue
          }
          const py = heightAt(terrain, px, pz)
          const h = (0.7 + r(b + 4) * 0.5) * (r(b + 6) < 0.25 ? 0.5 : 1)
          const lx = (r(b + 8) - 0.5) * 0.35
          const lz = (r(b + 9) - 0.5) * 0.35
          m.at(px, py, pz, 0, 0)
          m.block(
            px,
            py - 0.1,
            pz,
            0.1,
            h + 0.1,
            0.1,
            turn,
            pick(POST, r(b)),
            pick(POST, r(b)),
            lx,
            lz,
          )
          const top = [px + lx * 0.7, py + h * 0.7, pz + lz * 0.7]
          if (prev && r(b + 11) < 0.55) m.stick(prev, top, 0.04, POST[1] as THREE.Color)
          prev = top
        }
        break
      }
    }
  }
  return { main: m.empty ? null : m.build(), glow: g.empty ? null : g.build() }
}

/** Ground detail shrinks into the ground between these distances from the camera (m). */
export const DETAIL_FADE: [number, number] = [52, 74]

const fadeUniforms = { uDetailFade: { value: new THREE.Vector2(...DETAIL_FADE) } }

/**
 * Patches a material for ground detail: sways in the wind (optionally), shrinks towards its
 * anchor far from the camera, and lights both faces as if they faced up (thin blades).
 */
function patchDetail(material: THREE.Material, sway: boolean, key: string): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, fadeUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 sway;\nattribute vec3 anchor;\nuniform float uWindTime;\nuniform float uWindGust;\nuniform vec2 uWindDir;\nuniform vec2 uDetailFade;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${sway ? SWAY_VERTEX : ''}
        float detailFade = 1.0 - smoothstep(uDetailFade.x, uDetailFade.y, distance(anchor.xz, cameraPosition.xz));
        transformed = mix(anchor, transformed, detailFade);`,
      )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
    )
  }
  material.customProgramCacheKey = () => key
}

/** The materials ground detail is drawn with (shared by every chunk). */
export function detailMaterials(): { main: THREE.Material; glow: THREE.Material } {
  const main = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  patchDetail(main, true, 'detail')
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true })
  patchDetail(glow, false, 'detail-glow')
  return { main, glow }
}

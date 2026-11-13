import {
  CELL,
  CHUNK,
  CHUNKS,
  chunkOf,
  chunkProps,
  hash2,
  heightAt,
  PropKind,
  type Road,
  Surface,
  type SurvivalDef,
  surfaceAt,
  WORLD_HALF,
} from '@office-fps/shared'
import * as THREE from 'three'
import { getSurfaceMaterial } from './textures.ts'

/** Ground and forest are drawn in chunks whose centre is within this of you (m). */
const VIEW = 170
/** Chunks built per frame once the ones right around you exist (keeps frames even). */
const PER_FRAME = 1

/** Collects flat-shaded, vertex-coloured triangles. */
class Triangles {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly color: number[] = []

  tri(a: number[], b: number[], c: number[], color: THREE.Color): void {
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
      this.color.push(color.r, color.g, color.b)
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color): void {
    this.tri(a, b, c, color)
    this.tri(a, c, d, color)
  }

  /**
   * An upright box turned `turn` (radians) about the vertical through (x, z), from `y` up `h`,
   * leaning by (lx, lz) metres at the top.
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
    top = color,
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
  ): void {
    const tip = [x, y + h, z]
    const base: number[][] = []
    for (let i = 0; i < 4; i++) {
      const a = turn + (i * Math.PI) / 2
      base.push([x + Math.cos(a) * r, y, z - Math.sin(a) * r])
    }
    for (let i = 0; i < 4; i++) {
      this.tri(base[i] as number[], base[(i + 1) % 4] as number[], tip, i % 2 === 0 ? color : dark)
    }
    this.quad(
      base[0] as number[],
      base[3] as number[],
      base[2] as number[],
      base[1] as number[],
      dark,
    )
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    return g
  }
}

const col = (hex: number) => new THREE.Color(hex)
const BARK = col(0x33261a)
const BARK_DARK = col(0x241a12)
const NEEDLES = [col(0x1c3520), col(0x22402a), col(0x17301c), col(0x2a4526)]
const NEEDLES_DARK = [col(0x122416), col(0x162c1c), col(0x0f2012), col(0x1c3019)]
const DEAD = col(0x4a443c)
const BIRCH = col(0xb9b6a8)
const BIRCH_LEAF = col(0x4a5a22)
const ROCK = col(0x4f5356)
const ROCK_TOP = col(0x5d6266)
const STUMP_TOP = col(0x7a6444)
const BUSH = [col(0x1f3a1c), col(0x2a4a22)]
const FERN = col(0x35592a)

const GROUND: Record<number, THREE.Color[]> = {
  [Surface.Forest]: [col(0x2a2c1a), col(0x30301c), col(0x24281a)],
  [Surface.Meadow]: [col(0x35451f), col(0x3d4f24), col(0x2f3f1c)],
  [Surface.Dirt]: [col(0x43382a), col(0x4a3e2e), col(0x3b3226)],
  [Surface.Sand]: [col(0x6e6449), col(0x776c50), col(0x655c42)],
  [Surface.Rock]: [col(0x505356), col(0x5a5d60), col(0x47494c)],
}

function makeGroundTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      // Speckle: mostly mid-grey with darker twigs and lighter needles.
      const v = 150 + Math.floor(hash2(x, y, 11) * 90)
      const roll = hash2(x, y, 12)
      const g = roll < 0.06 ? v - 70 : roll > 0.95 ? Math.min(255, v + 40) : v
      ctx.fillStyle = `rgb(${g},${g},${g})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapNearestFilter
  return texture
}

interface Chunk {
  ground: THREE.Mesh
  props: THREE.Mesh
}

/**
 * The survival world outside the buildings: the ground, the forest, roads and lakes. The ground
 * and the trees are built chunk by chunk around the viewer (the night hides the rest); roads and
 * lakes are few and built once.
 */
export class Wilds {
  readonly root = new THREE.Group()
  private readonly def: SurvivalDef
  private readonly chunks = new Map<number, Chunk>()
  private readonly groundMaterial = new THREE.MeshLambertMaterial({
    map: makeGroundTexture(),
    vertexColors: true,
  })
  private readonly propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
  private primed = false

  constructor(def: SurvivalDef) {
    this.def = def
    this.root.name = 'wilds'
    for (const road of def.roads) this.root.add(this.buildRoad(road))
    const water = new THREE.MeshLambertMaterial({
      color: 0x0d1b28,
      emissive: 0x06101a,
      transparent: true,
      opacity: 0.88,
    })
    for (const lake of def.lakes) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(lake.r + 28, 40).rotateX(-Math.PI / 2),
        water,
      )
      mesh.position.set(lake.x, lake.y, lake.z)
      mesh.name = 'lake'
      this.root.add(mesh)
    }
  }

  /**
   * Builds the chunks around (x, z) that aren't there yet and drops the ones left behind.
   * Returns true when anything was added (the shadows want redrawing).
   */
  update(x: number, z: number): boolean {
    const [ccx, ccz] = chunkOf(x, z)
    const reach = Math.ceil(VIEW / CHUNK)
    const wanted: { key: number; cx: number; cz: number; d: number }[] = []
    for (let cx = Math.max(0, ccx - reach); cx <= Math.min(CHUNKS - 1, ccx + reach); cx++) {
      for (let cz = Math.max(0, ccz - reach); cz <= Math.min(CHUNKS - 1, ccz + reach); cz++) {
        const d = Math.hypot(
          (cx + 0.5) * CHUNK - WORLD_HALF - x,
          (cz + 0.5) * CHUNK - WORLD_HALF - z,
        )
        if (d <= VIEW) wanted.push({ key: cx * CHUNKS + cz, cx, cz, d })
      }
    }
    const keep = new Set(wanted.map((w) => w.key))
    for (const [key, chunk] of this.chunks) {
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      const d = Math.hypot((cx + 0.5) * CHUNK - WORLD_HALF - x, (cz + 0.5) * CHUNK - WORLD_HALF - z)
      if (keep.has(key) || d < VIEW + CHUNK) continue
      this.root.remove(chunk.ground, chunk.props)
      chunk.ground.geometry.dispose()
      chunk.props.geometry.dispose()
      this.chunks.delete(key)
    }
    const missing = wanted.filter((w) => !this.chunks.has(w.key)).sort((a, b) => a.d - b.d)
    // Everything at once the first time and after a teleport; then a little per frame.
    const near = missing.filter((m) => m.d < CHUNK * 1.6).length
    const budget =
      !this.primed || near > 0 ? Math.max(near, this.primed ? 0 : missing.length) : PER_FRAME
    for (const m of missing.slice(0, Math.max(budget, PER_FRAME))) {
      const chunk = this.buildChunk(m.cx, m.cz)
      this.chunks.set(m.key, chunk)
      this.root.add(chunk.ground, chunk.props)
    }
    this.primed = true
    return missing.length > 0
  }

  private buildChunk(cx: number, cz: number): Chunk {
    const t = this.def.terrain
    const x0 = cx * CHUNK - WORLD_HALF
    const z0 = cz * CHUNK - WORLD_HALF
    const cells = CHUNK / CELL
    const n = cells + 1
    const position = new Float32Array(n * n * 3)
    const normal = new Float32Array(n * n * 3)
    const color = new Float32Array(n * n * 3)
    const uv = new Float32Array(n * n * 2)
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
        const shades = GROUND[surfaceAt(t, x, z)] ?? (GROUND[Surface.Forest] as THREE.Color[])
        const c = shades[
          Math.floor(hash2(Math.round(x), Math.round(z), 3) * shades.length)
        ] as THREE.Color
        color.set([c.r, c.g, c.b], k * 3)
        uv.set([x / 6, z / 6], k * 2)
      }
    }
    const index: number[] = []
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const a = i * n + j
        const b = a + 1
        const c = a + n
        const d = c + 1
        // Split along the same diagonal as the physics heightfield: (x+1, z) – (x, z+1).
        index.push(a, b, c, c, b, d)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geometry.setIndex(index)
    const ground = new THREE.Mesh(geometry, this.groundMaterial)
    ground.receiveShadow = true
    ground.name = 'ground'

    const tris = new Triangles()
    for (const p of chunkProps(t, this.def.seed, cx, cz)) {
      const turn = p.turn * Math.PI * 2
      const s = p.scale
      const pick = Math.floor(p.turn * 4) % 4
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
    const props = new THREE.Mesh(tris.build(), this.propMaterial)
    props.castShadow = true
    props.receiveShadow = true
    props.name = 'forest'
    return { ground, props }
  }

  /** A strip along the road's centre line, lying just above the ground it levelled. */
  private buildRoad(road: Road): THREE.Group {
    const group = new THREE.Group()
    group.name = `road:${road.kind}`
    const line = road.line
    const position: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const half = road.width / 2
    const marks = new Triangles()
    const paint = col(0x8a7c3a)
    let along = 0
    for (let i = 0; i < line.length; i++) {
      const p = line[i] as { x: number; y: number; z: number }
      const a = line[Math.max(0, i - 1)] as typeof p
      const b = line[Math.min(line.length - 1, i + 1)] as typeof p
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const px = -(b.z - a.z) / l
      const pz = (b.x - a.x) / l
      if (i > 0) along += Math.hypot(p.x - a.x, p.z - a.z)
      position.push(
        p.x - px * half,
        p.y + 0.06,
        p.z - pz * half,
        p.x + px * half,
        p.y + 0.06,
        p.z + pz * half,
      )
      uv.push(0, along, road.width, along)
      if (i > 0) {
        const k = i * 2
        index.push(k - 2, k - 1, k, k - 1, k + 1, k)
        // Faded centre dashes on asphalt.
        if (road.kind === 'asphalt' && i % 6 < 2) {
          const w = 0.09
          marks.quad(
            [a.x + px * w, a.y + 0.075, a.z + pz * w],
            [p.x + px * w, p.y + 0.075, p.z + pz * w],
            [p.x - px * w, p.y + 0.075, p.z - pz * w],
            [a.x - px * w, a.y + 0.075, a.z - pz * w],
            paint,
          )
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.setIndex(index)
    geometry.computeVertexNormals()
    const material = (
      getSurfaceMaterial(road.kind === 'asphalt' ? 'asphalt' : 'dirt') as THREE.MeshLambertMaterial
    ).clone()
    material.polygonOffset = true
    material.polygonOffsetFactor = -2
    material.polygonOffsetUnits = -4
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    group.add(mesh)
    if (marks.position.length > 0) {
      const lines = new THREE.Mesh(
        marks.build(),
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -8,
        }),
      )
      lines.receiveShadow = true
      group.add(lines)
    }
    return group
  }
}

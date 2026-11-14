import {
  CELL,
  CHUNK,
  CHUNKS,
  chunkOf,
  chunkProps,
  hash2,
  heightAt,
  type Prop,
  PropKind,
  type Road,
  RoadGrid,
  type SurvivalDef,
  WORLD_HALF,
} from '@office-fps/shared'
import * as THREE from 'three'
import { FarForest } from './forest-lod.ts'
import { type GroundColour, groundColour } from './ground-colour.ts'
import { buildDetail, detailItems, detailMaterials } from './ground-detail.ts'
import { buildSigns } from './road-signs.ts'
import { filterTexture, getSurfaceMaterial } from './textures.ts'
import { wetGroundMaterial, wetUniforms } from './wet-ground.ts'
import { makeSwaying } from './wind.ts'

// --- Level of detail ----------------------------------------------------------------------
// Chunks whose centre is within NEAR of you are built in full (every bush and fern, swaying);
// out to MID, simplified trees (a few cones, no undergrowth, still); beyond, out to FAR, the
// coarse ground and tree cards of forest-lod.ts. Which chunks are shown is measured from the
// centre of the chunk you're in, so the set (and the far forest's hole) only changes when you
// cross into another chunk.
/** Full-detail chunks: centre within this of you (m). */
const NEAR = 100
/** Real chunks (ground at full resolution, simplified trees): centre within this (m). */
const MID = 190
/** A chunk only changes detail this far (m) past the line, so walking along it costs nothing. */
const SLACK = 10
/** Changes within this of you (m) redraw the shadows (they reach about 80 m). */
const SHADOW_CHUNKS = 100
/** Chunks built per frame once the ones right around you exist (keeps frames even). */
const PER_FRAME = 1
/** Ground detail (grass, twigs, mushrooms…) is built for chunks this close to you (m). */
const DETAIL_VIEW = 78

/** Collects flat-shaded, vertex-coloured triangles. */
class Triangles {
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
    for (let i = 0; i < 4; i++) {
      this.tri(rim[i] as number[], rim[(i + 1) % 4] as number[], tip, i % 2 === 0 ? color : dark)
    }
    if (!base) return
    this.quad(rim[0] as number[], rim[3] as number[], rim[2] as number[], rim[1] as number[], dark)
  }

  /** @param sway keep the wind attribute (still, distant trees don't need it) */
  build(sway = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    if (sway) g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sway, 2))
    return g
  }
}

const col = (hex: number) => new THREE.Color(hex)

/** How much each kind of plant gives in the wind (rocks and logs not at all). */
const STIFFNESS: Partial<Record<PropKind, number>> = {
  [PropKind.Pine]: 0.8,
  [PropKind.Birch]: 1,
  [PropKind.DeadTree]: 0.45,
  [PropKind.Bush]: 1.6,
  [PropKind.Fern]: 3,
}

const swaying = <M extends THREE.Material>(material: M): M => {
  makeSwaying(material)
  return material
}
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

const RUT = col(0x241c14)
const RUT_GRASS = col(0x2e3a1c)
const EDGE = col(0x77756c)
const TAR = col(0x121214)
const OIL = col(0x1a1820)
const PUDDLE = col(0x141c26)
/** Puddles' shine, dry weather and in the rain. */
const PUDDLE_SHINE = col(0x9aa8b8)
const PUDDLE_SHINE_WET = col(0xd8e2ee)

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
  filterTexture(texture)
  return texture
}

/** Ground colour at a point, as the chunks paint it (for the far ground in forest-lod.ts). */
const farGround: GroundColour = { r: 0, g: 0, b: 0, mud: 0 }
function groundColor(def: SurvivalDef, x: number, z: number): THREE.Color {
  const c = groundColour(def.terrain, def.lakes, x, z, farGround)
  return new THREE.Color(c.r, c.g, c.b)
}

/** How a chunk's trees are drawn: in full, or simplified (see NEAR, MID). */
const Detail = { Full: 0, Simple: 1 } as const
type Detail = (typeof Detail)[keyof typeof Detail]

interface Chunk {
  ground: THREE.Mesh
  props: THREE.Mesh
  detailLevel: Detail
  /** What grows here (chunkProps), kept for when the chunk changes detail. */
  items: readonly Prop[]
  /** Inside the far forest's hole (drawn), or waiting for it to move here. */
  shown: boolean
  /** The little things on the ground, near you only (see ground-detail.ts). */
  detail: THREE.Group | null
}

const chunkCentre = (c: number) => (c + 0.5) * CHUNK - WORLD_HALF

/** Distance from (x, z) to the nearest point of a chunk (0 inside it). */
function chunkDistance(cx: number, cz: number, x: number, z: number): number {
  const x0 = cx * CHUNK - WORLD_HALF
  const z0 = cz * CHUNK - WORLD_HALF
  const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK))
  const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK))
  return Math.hypot(dx, dz)
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
  // Weather: the ground soaks up the rain (wet-ground.ts) and the puddles gleam (setWetness).
  private readonly groundMaterial = wetGroundMaterial(makeGroundTexture())
  private readonly puddleMaterials: THREE.MeshPhongMaterial[] = []
  private readonly propMaterial = swaying(new THREE.MeshLambertMaterial({ vertexColors: true }))
  /** Simplified trees don't sway: no wind work in their shader. */
  private readonly stillMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
  private readonly detailMaterial = detailMaterials()
  private readonly roads: RoadGrid
  private readonly far: FarForest
  /** The chunk the far forest's hole is centred on (-1: not built yet). */
  private hole = -1
  private primed = false

  constructor(def: SurvivalDef) {
    this.def = def
    this.root.name = 'wilds'
    this.far = new FarForest(
      {
        terrain: def.terrain,
        groundMaterial: this.groundMaterial,
        groundColor: (x, z) => groundColor(def, x, z),
        props: (cx, cz) =>
          this.chunks.get(cx * CHUNKS + cz)?.items ?? chunkProps(def.terrain, def.seed, cx, cz),
      },
      {
        bark: BARK,
        barkDark: BARK_DARK,
        needles: NEEDLES,
        needlesDark: NEEDLES_DARK,
        birch: BIRCH,
        birchLeaf: BIRCH_LEAF,
        dead: DEAD,
      },
    )
    this.root.add(this.far.root)
    this.roads = new RoadGrid(def.roads)
    if (def.signs?.length) this.root.add(buildSigns(def.signs))
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

  /** How soaked the ground is, 0 dry … 1 after a long rain: darker, muddier, shinier. */
  setWetness(wet: number): void {
    wetUniforms.uWet.value = wet
    for (const m of this.puddleMaterials) {
      m.specular.copy(PUDDLE_SHINE).lerp(PUDDLE_SHINE_WET, wet)
      m.shininess = 90 + wet * 60
    }
  }

  /**
   * Builds the chunks around (x, z) that aren't there yet, brings the ones you walk towards to
   * full detail (and back), drops the ones left behind and moves the far forest along.
   * Returns true when the shadows want redrawing (something changed near you).
   */
  update(x: number, z: number): boolean {
    const [ccx, ccz] = chunkOf(x, z)
    const centre = ccx * CHUNKS + ccz
    const reach = Math.ceil(MID / CHUNK)
    /** The chunks drawn in full around chunk (hx, hz); the far forest leaves a hole for them. */
    const inner = (hx: number, hz: number) => (cx: number, cz: number) =>
      Math.hypot(cx - hx, cz - hz) * CHUNK <= MID
    const wanted: { key: number; cx: number; cz: number; d: number }[] = []
    const isWanted = inner(ccx, ccz)
    for (let cx = Math.max(0, ccx - reach); cx <= Math.min(CHUNKS - 1, ccx + reach); cx++) {
      for (let cz = Math.max(0, ccz - reach); cz <= Math.min(CHUNKS - 1, ccz + reach); cz++) {
        if (!isWanted(cx, cz)) continue
        const d = Math.hypot(chunkCentre(cx) - x, chunkCentre(cz) - z)
        wanted.push({ key: cx * CHUNKS + cz, cx, cz, d })
      }
    }
    const keep = new Set(wanted.map((w) => w.key))
    let changed = false
    for (const [key, chunk] of this.chunks) {
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      const d = Math.hypot(chunkCentre(cx) - x, chunkCentre(cz) - z)
      if (keep.has(key) || d < MID + CHUNK) continue
      this.root.remove(chunk.ground, chunk.props)
      chunk.ground.geometry.dispose()
      chunk.props.geometry.dispose()
      this.dropDetail(chunk)
      this.chunks.delete(key)
    }
    // Chunks to build, and built ones whose detail should change: nearest first.
    const work: { key: number; cx: number; cz: number; d: number; level: Detail }[] = []
    for (const w of wanted) {
      const chunk = this.chunks.get(w.key)
      const want = w.d <= NEAR ? Detail.Full : Detail.Simple
      if (!chunk) work.push({ ...w, level: want })
      else if (chunk.detailLevel !== want && Math.abs(w.d - NEAR) > SLACK) {
        work.push({ ...w, level: want })
      }
    }
    work.sort((a, b) => a.d - b.d)
    // Everything at once the first time and after a teleport; then a little per frame.
    const near = work.filter((m) => m.d < CHUNK * 1.6).length
    const hx = Math.floor(this.hole / CHUNKS)
    const hz = this.hole % CHUNKS
    const jumped = this.hole >= 0 && Math.max(Math.abs(hx - ccx), Math.abs(hz - ccz)) > 2
    const budget = !this.primed || jumped ? work.length : near > 0 ? near : PER_FRAME
    for (const m of work.slice(0, Math.max(budget, PER_FRAME))) {
      const chunk = this.chunks.get(m.key)
      if (chunk) this.setDetail(chunk, m.level)
      else {
        const built = this.buildChunk(m.cx, m.cz, m.level)
        this.chunks.set(m.key, built)
        this.root.add(built.ground, built.props)
      }
      if (m.d < SHADOW_CHUNKS + CHUNK / 2) changed = true
    }
    // The far forest moves once every chunk it would leave a hole for is there.
    if (centre !== this.hole && wanted.every((w) => this.chunks.has(w.key))) {
      this.hole = centre
      this.far.rebuild(ccx, ccz, isWanted)
      for (const [key, chunk] of this.chunks) {
        chunk.shown = keep.has(key)
        chunk.ground.visible = chunk.props.visible = chunk.shown
      }
    }
    this.updateDetail(x, z, budget)
    this.primed = true
    return changed
  }

  /**
   * Hides what the fog hides anyway: real chunks beyond `fogFar` of (x, z), and the far forest
   * when the fog closes in (night). Call once a frame, after the fog is set.
   */
  cull(x: number, z: number, fogFar: number): void {
    for (const [key, chunk] of this.chunks) {
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      const seen = chunk.shown && chunkDistance(cx, cz, x, z) < fogFar + 4
      chunk.ground.visible = chunk.props.visible = seen
    }
    this.far.cull(fogFar, MID - CHUNK)
  }

  /** Ground detail for the chunks right around (x, z); dropped again once you've walked on. */
  private updateDetail(x: number, z: number, budget: number): void {
    const wanted: { chunk: Chunk; cx: number; cz: number; d: number }[] = []
    for (const [key, chunk] of this.chunks) {
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      const d = chunkDistance(cx, cz, x, z)
      if (chunk.detail && d > DETAIL_VIEW + 24) this.dropDetail(chunk)
      else if (!chunk.detail && d <= DETAIL_VIEW) wanted.push({ chunk, cx, cz, d })
    }
    wanted.sort((a, b) => a.d - b.d)
    // The chunk you stand in at once; the rest a chunk a frame.
    const now = Math.max(PER_FRAME, budget, wanted.filter((w) => w.d === 0).length)
    for (const w of wanted.slice(0, now)) {
      const items = detailItems(this.def, this.roads, w.cx, w.cz)
      const { main, glow } = buildDetail(this.def.terrain, items)
      const group = new THREE.Group()
      group.name = 'ground-detail'
      if (main) {
        const mesh = new THREE.Mesh(main, this.detailMaterial.main)
        mesh.receiveShadow = true
        group.add(mesh)
      }
      if (glow) group.add(new THREE.Mesh(glow, this.detailMaterial.glow))
      w.chunk.detail = group
      this.root.add(group)
    }
  }

  private dropDetail(chunk: Chunk): void {
    if (!chunk.detail) return
    this.root.remove(chunk.detail)
    for (const child of chunk.detail.children) (child as THREE.Mesh).geometry.dispose()
    chunk.detail = null
  }

  private buildChunk(cx: number, cz: number, level: Detail): Chunk {
    const t = this.def.terrain
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
        groundColour(t, this.def.lakes, x, z, ground)
        color.set([ground.r, ground.g, ground.b], k * 3)
        mud[k] = ground.mud
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
    geometry.setAttribute('mud', new THREE.BufferAttribute(mud, 1))
    geometry.setIndex(index)
    const groundMesh = new THREE.Mesh(geometry, this.groundMaterial)
    groundMesh.receiveShadow = true
    groundMesh.name = 'ground'

    const items = chunkProps(t, this.def.seed, cx, cz)
    const chunk: Chunk = {
      ground: groundMesh,
      props: this.buildProps(items, level),
      detailLevel: level,
      items,
      shown: this.hole < 0,
      detail: null,
    }
    chunk.ground.visible = chunk.props.visible = chunk.shown
    return chunk
  }

  /** Swaps a chunk's trees for the full or the simplified ones. */
  private setDetail(chunk: Chunk, level: Detail): void {
    const props = this.buildProps(chunk.items, level)
    props.visible = chunk.props.visible
    this.root.remove(chunk.props)
    chunk.props.geometry.dispose()
    chunk.props = props
    chunk.detailLevel = level
    this.root.add(props)
  }

  private buildProps(items: readonly Prop[], level: Detail): THREE.Mesh {
    if (level === Detail.Simple) {
      const props = new THREE.Mesh(simpleProps(items).build(false), this.stillMaterial)
      props.castShadow = true
      props.receiveShadow = true
      props.name = 'forest-simple'
      return props
    }
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
    const props = new THREE.Mesh(tris.build(), this.propMaterial)
    props.castShadow = true
    props.receiveShadow = true
    props.name = 'forest'
    return props
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
    /** Wear: tyre ruts, tar patches, oil, and puddles (shiny, see below). */
    const wear = new Triangles()
    const wet = new Triangles()
    const asphalt = road.kind === 'asphalt'
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
        this.roadWear(road, i, a, p, px, pz, wear, wet)
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
    if (wear.position.length > 0) {
      const ruts = new THREE.Mesh(
        wear.build(),
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          transparent: true,
          opacity: asphalt ? 0.7 : 0.4,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -6,
        }),
      )
      ruts.receiveShadow = true
      ruts.renderOrder = 1
      group.add(ruts)
    }
    if (wet.position.length > 0) {
      // Puddles: dark, and they catch the moon and the lamps.
      const shiny = new THREE.MeshPhongMaterial({
        vertexColors: true,
        shininess: 90,
        specular: PUDDLE_SHINE,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -10,
      })
      this.puddleMaterials.push(shiny)
      const puddles = new THREE.Mesh(wet.build(), shiny)
      puddles.receiveShadow = true
      puddles.name = 'puddles'
      group.add(puddles)
    }
    return group
  }

  /**
   * One stretch of road (line point a to p, `px`/`pz` the unit normal): tyre ruts along dirt
   * tracks, worn edge lines, tar patches and oil stains on asphalt, and now and then a puddle.
   */
  private roadWear(
    road: Road,
    i: number,
    a: { x: number; y: number; z: number },
    p: { x: number; y: number; z: number },
    px: number,
    pz: number,
    wear: Triangles,
    wet: Triangles,
  ): void {
    const half = road.width / 2
    const roll = (k: number) => hash2(Math.round(p.x * 4) + k, Math.round(p.z * 4), 4242)
    const strip = (off: number, w: number, y: number, color: THREE.Color) =>
      wear.quad(
        [a.x + px * (off + w), a.y + y, a.z + pz * (off + w)],
        [p.x + px * (off + w), p.y + y, p.z + pz * (off + w)],
        [p.x + px * (off - w), p.y + y, p.z + pz * (off - w)],
        [a.x + px * (off - w), a.y + y, a.z + pz * (off - w)],
        color,
      )
    if (road.kind === 'dirt') {
      // Two ruts, wandering a little, with tufts of grass down the middle now and then.
      const wander = Math.sin(i * 0.045 + road.line.length) * 0.14 + Math.sin(i * 0.17) * 0.04
      strip(-0.78 + wander, 0.15, 0.07, RUT)
      strip(0.78 + wander, 0.15, 0.07, RUT)
      if (Math.sin(i * 0.09 + 1.3) + roll(10) * 0.6 > 0.7) strip(wander, 0.18, 0.068, RUT_GRASS)
    } else {
      // Worn white edge lines, gone in places.
      if (roll(1) > 0.18) strip(half - 0.3, 0.06, 0.072, EDGE)
      if (roll(2) > 0.18) strip(-half + 0.3, 0.06, 0.072, EDGE)
      if (roll(3) < 0.05) {
        const off = (roll(4) - 0.5) * (road.width - 2)
        strip(off, 0.4 + roll(5) * 0.6, 0.071, roll(6) < 0.5 ? TAR : OIL)
      }
    }
    // A puddle in a rut or a pothole.
    if (roll(7) < (road.kind === 'dirt' ? 0.045 : 0.012)) {
      const off =
        road.kind === 'dirt' ? (roll(8) < 0.5 ? -0.8 : 0.8) : (roll(8) - 0.5) * (road.width - 2)
      const cx = p.x + px * off
      const cz = p.z + pz * off
      const y = p.y + 0.085
      const r = 0.45 + roll(9) * 0.9
      const n = 9
      const rim: number[][] = []
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2
        const rr = r * (0.7 + hash2(k, Math.round(cx * 4), 4244) * 0.5)
        // Long along the road.
        const u = Math.cos(ang) * rr * 1.5
        const v = Math.sin(ang) * rr * 0.7
        rim.push([cx + pz * u + px * v, y, cz - px * u + pz * v])
      }
      // Wind the fan so it faces up.
      const [x0 = 0, , z0 = 0] = rim[0] as number[]
      const [x1 = 0, , z1 = 0] = rim[1] as number[]
      const up = (z0 - cz) * (x1 - cx) - (x0 - cx) * (z1 - cz) > 0
      for (let k = 0; k < n; k++) {
        const b = rim[k] as number[]
        const c = rim[(k + 1) % n] as number[]
        if (up) wet.tri([cx, y, cz], b, c, PUDDLE)
        else wet.tri([cx, y, cz], c, b, PUDDLE)
      }
    }
  }
}

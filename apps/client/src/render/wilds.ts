import {
  CHUNK,
  CHUNKS,
  chunkOf,
  chunkProps,
  hash2,
  type Lake,
  lakeLevel,
  lakeReach,
  type Prop,
  type Road,
  RoadGrid,
  type SurvivalDef,
  WORLD_HALF,
} from '@office-fps/shared'
import * as THREE from 'three'
import { ChunkBuilder } from './chunk-builder.ts'
import {
  BARK,
  BARK_DARK,
  BIRCH,
  BIRCH_LEAF,
  type ChunkJob,
  type ChunkResult,
  col,
  DEAD,
  Detail,
  NEEDLES,
  NEEDLES_DARK,
  Triangles,
} from './chunk-geometry.ts'
import { TIER_SETTINGS, type TierSettings } from './device-tier.ts'
import { FarForest } from './forest-lod.ts'
import { type GeometryData, toGeometry } from './geometry-data.ts'
import { makeGrained } from './grain.ts'
import { type GroundColour, groundColour } from './ground-colour.ts'
import { detailMaterials } from './ground-detail.ts'
import { dataTexture, paintForestFloor } from './pixel-textures.ts'
import { buildSigns } from './road-signs.ts'
import { filterTexture, getSurfaceMaterial, onTexelDensity, texelsPerMeter } from './textures.ts'
import { wetGroundMaterial, wetUniforms } from './wet-ground.ts'
import { makeSwaying } from './wind.ts'

// --- Level of detail ----------------------------------------------------------------------
// Chunks whose centre is within `forestNear` of you are built in full (every bush and fern,
// swaying); out to `forestMid`, simplified trees (a few cones, no undergrowth, still); beyond,
// out to `forestFar`, the coarse ground and tree cards of forest-lod.ts. The distances come with
// the device tier (device-tier.ts; High: 100, 190 and 450 m). Which chunks are shown is measured
// from the centre of the chunk you're in, so the set (and the far forest's hole) only changes
// when you cross into another chunk.
/** A chunk only changes detail this far (m) past the line, so walking along it costs nothing. */
const SLACK = 10
/** Changes within this of you (m) redraw the shadows (they reach about 80 m). */
const SHADOW_CHUNKS = 100
/** Chunks built per frame when building on the main thread (keeps frames even). */
const PER_FRAME = 1
/** Jobs out with the worker at once: few, so the nearest work goes next as you move. */
const IN_FLIGHT = 3
/** Finished chunks put into the scene per frame (their upload to the GPU costs a little). */
const APPLY_PER_FRAME = 2

const swaying = <M extends THREE.Material>(material: M): M => {
  makeSwaying(material)
  return material
}
const grained = <M extends THREE.Material>(material: M): M => {
  makeGrained(material)
  return material
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

/** The ground's UVs repeat every this many metres (chunk-geometry.ts, forest-lod.ts). */
const GROUND_TILE = 6

/**
 * The forest floor's pixel detail (needles, twigs, pebbles, tufts) at the world surfaces'
 * texel density, repainted in place when that changes (Low tier: half).
 */
function makeFloorTexture(): THREE.DataTexture {
  const paint = (tpm: number) => {
    const size = GROUND_TILE * tpm
    return { data: paintForestFloor(size, GROUND_TILE, 0x7f3a11), width: size, height: size }
  }
  const texture = dataTexture(paint(texelsPerMeter()).data, GROUND_TILE * texelsPerMeter(), 1)
  filterTexture(texture)
  onTexelDensity((tpm) => {
    texture.image = paint(tpm)
    texture.dispose()
    texture.needsUpdate = true
  })
  return texture
}

/** A coarse speckle, for the ground's big soft patches (wet-ground.ts). */
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

interface Chunk {
  ground: THREE.Mesh
  props: THREE.Mesh
  detailLevel: Detail
  /** What grows here (chunkProps), for the far forest's cards. */
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

/** One name per piece of work, so it's never asked for twice while out. */
function jobKey(job: ChunkJob): string {
  const extra = job.kind === 'detail' ? job.density : job.level
  return `${job.kind}:${job.cx},${job.cz}:${extra}`
}

/**
 * The survival world outside the buildings: the ground, the forest, roads and lakes. The ground
 * and the trees are built chunk by chunk around the viewer (the night hides the rest), mostly in
 * a worker (chunk-builder.ts); roads and lakes are few and built once.
 */
export class Wilds {
  readonly root = new THREE.Group()
  private readonly chunks = new Map<number, Chunk>()
  // Weather: the ground soaks up the rain (wet-ground.ts) and the puddles gleam (setWetness).
  private readonly groundMaterial = wetGroundMaterial(makeFloorTexture(), makeGroundTexture())
  private readonly puddleMaterials: THREE.MeshPhongMaterial[] = []
  // Both grained (grain.ts): bark, leaves and rock look the same near and simplified.
  private readonly propMaterial = grained(
    swaying(new THREE.MeshLambertMaterial({ vertexColors: true })),
  )
  /** Simplified trees don't sway: no wind work in their shader. */
  private readonly stillMaterial = grained(new THREE.MeshLambertMaterial({ vertexColors: true }))
  private readonly detailMaterial = detailMaterials()
  private readonly roads: RoadGrid
  private readonly far: FarForest
  /** The lakes' water, to raise in a flood (setFlood), with each lake as it was made. */
  private readonly waters: { mesh: THREE.Mesh; lake: Lake }[] = []
  private readonly builder: ChunkBuilder
  /** Work sent to the builder and not back yet (see jobKey). */
  private readonly pending = new Set<string>()
  private tier: TierSettings = TIER_SETTINGS.high
  /** The chunk the far forest's hole is centred on (-1: not built yet). */
  private hole = -1
  /** The far forest wants rebuilding even where it is (the tier changed). */
  private farStale = false
  private primed = false

  /** @param worker build chunks in a Web Worker (default: in the browser, see chunk-builder.ts) */
  constructor(def: SurvivalDef, worker?: boolean) {
    this.root.name = 'wilds'
    this.builder = new ChunkBuilder(def, worker)
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
      this.waters.push({ mesh, lake })
    }
  }

  /**
   * How swollen the lakes are, 0–1 (weather-effects.ts): the water stands higher and spreads
   * over the low ground round about (the ground hides whatever is under it).
   */
  setFlood(flood: number): void {
    for (const { mesh, lake } of this.waters) {
      mesh.position.y = lakeLevel(lake, flood)
      mesh.scale.setScalar(lakeReach(lake, flood) / (lake.r + 28))
    }
  }

  /** Building chunks off the main thread? */
  get threaded(): boolean {
    return this.builder.threaded
  }

  /** How far the forest is drawn in full, simplified and as cards, and how thick the grass. */
  setTier(tier: TierSettings): void {
    if (tier === this.tier) return
    const density = tier.detailDensity !== this.tier.detailDensity
    this.tier = tier
    this.far.reach = tier.forestFar
    this.farStale = true
    // Thinner or thicker ground detail: built again as it comes back into view.
    if (density) for (const chunk of this.chunks.values()) this.dropDetail(chunk)
  }

  /** How much snow lies on the ground, 0 none … 1 covered (weather-marks.ts). */
  setSnow(snow: number): void {
    wetUniforms.uSnow.value = snow
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
    const near = this.tier.forestNear
    const mid = this.tier.forestMid
    const [ccx, ccz] = chunkOf(x, z)
    const centre = ccx * CHUNKS + ccz
    const reach = Math.ceil(mid / CHUNK)
    /** The chunks drawn in full around chunk (hx, hz); the far forest leaves a hole for them. */
    const inner = (hx: number, hz: number) => (cx: number, cz: number) =>
      Math.hypot(cx - hx, cz - hz) * CHUNK <= mid
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
    for (const [key, chunk] of this.chunks) {
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      const d = Math.hypot(chunkCentre(cx) - x, chunkCentre(cz) - z)
      if (keep.has(key) || d < mid + CHUNK) continue
      this.root.remove(chunk.ground, chunk.props)
      chunk.ground.geometry.dispose()
      chunk.props.geometry.dispose()
      this.dropDetail(chunk)
      this.chunks.delete(key)
    }
    const hx = Math.floor(this.hole / CHUNKS)
    const hz = this.hole % CHUNKS
    const jumped = this.hole >= 0 && Math.max(Math.abs(hx - ccx), Math.abs(hz - ccz)) > 2
    // What the worker finished since last frame (all of it after a teleport).
    let changed = false
    for (const r of this.builder.take(jumped ? undefined : APPLY_PER_FRAME)) {
      if (this.apply(r, x, z)) changed = true
    }
    // Chunks to build, and built ones whose detail should change: nearest first.
    const work: { job: ChunkJob; key: string; d: number; missing: boolean }[] = []
    for (const w of wanted) {
      const chunk = this.chunks.get(w.key)
      const level = w.d <= near ? Detail.Full : Detail.Simple
      if (chunk && (chunk.detailLevel === level || Math.abs(w.d - near) <= SLACK)) continue
      const job: ChunkJob = { kind: chunk ? 'props' : 'chunk', cx: w.cx, cz: w.cz, level }
      const key = jobKey(job)
      if (!this.pending.has(key)) work.push({ job, key, d: w.d, missing: !chunk })
    }
    work.sort((a, b) => a.d - b.d)
    // The first time only the chunk you're in, so the first frame shows quickly (the rest follow
    // over the next frames); everything at once after a teleport; the chunks right around you
    // as soon as they're missing. The rest: one a frame here, or a few at a time in the worker.
    const threaded = this.builder.threaded
    const close = work.filter((m) => (m.missing || !threaded) && m.d < CHUNK * 1.6).length
    const now = jumped ? work.length : !this.primed ? 1 : close
    work.forEach((m, i) => {
      const urgent = i < (threaded ? now : Math.max(now, PER_FRAME))
      if (urgent) {
        if (this.apply(this.builder.now(m.job), x, z)) changed = true
      } else if (threaded && this.builder.inFlight < IN_FLIGHT) {
        this.pending.add(m.key)
        this.builder.request(m.job)
      }
    })
    // The far forest moves once every chunk it would leave a hole for is there.
    if ((centre !== this.hole || this.farStale) && wanted.every((w) => this.chunks.has(w.key))) {
      this.hole = centre
      this.farStale = false
      this.far.rebuild(ccx, ccz, isWanted)
      for (const [key, chunk] of this.chunks) {
        chunk.shown = keep.has(key)
        chunk.ground.visible = chunk.props.visible = chunk.shown
      }
    }
    this.updateDetail(x, z, jumped)
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
    this.far.cull(fogFar, this.tier.forestMid - CHUNK, x, z)
  }

  dispose(): void {
    this.builder.dispose()
  }

  /**
   * Ground detail for the chunks right around (x, z); dropped again once you've walked on. The
   * chunk you stand in gets it at once, the others as they're built (all at once after a
   * teleport).
   */
  private updateDetail(x: number, z: number, all: boolean): void {
    const view = this.tier.detailView
    const density = this.tier.detailDensity
    const wanted: { job: ChunkJob; key: string; d: number }[] = []
    for (const [key, chunk] of this.chunks) {
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      const d = chunkDistance(cx, cz, x, z)
      if (chunk.detail && d > view + 24) this.dropDetail(chunk)
      else if (!chunk.detail && d <= view) {
        const job: ChunkJob = { kind: 'detail', cx, cz, density }
        const jk = jobKey(job)
        if (!this.pending.has(jk)) wanted.push({ job, key: jk, d })
      }
    }
    wanted.sort((a, b) => a.d - b.d)
    const here = wanted.filter((w) => w.d === 0).length
    const threaded = this.builder.threaded
    const now = all ? wanted.length : threaded ? here : Math.max(PER_FRAME, here)
    wanted.forEach((w, i) => {
      if (i < now) this.apply(this.builder.now(w.job), x, z)
      else if (threaded && this.builder.inFlight < IN_FLIGHT) {
        this.pending.add(w.key)
        this.builder.request(w.job)
      }
    })
  }

  /**
   * Puts finished work into the scene, unless you've moved on and it isn't wanted any more.
   * Returns true when it changed something near enough to redraw the shadows.
   */
  private apply(r: ChunkResult, x: number, z: number): boolean {
    this.pending.delete(jobKey(r))
    const key = r.cx * CHUNKS + r.cz
    const d = Math.hypot(chunkCentre(r.cx) - x, chunkCentre(r.cz) - z)
    const chunk = this.chunks.get(key)
    switch (r.kind) {
      case 'chunk': {
        if (chunk || d >= this.tier.forestMid + CHUNK) return false
        const ground = new THREE.Mesh(toGeometry(r.ground), this.groundMaterial)
        ground.receiveShadow = true
        ground.name = 'ground'
        const built: Chunk = {
          ground,
          props: this.propsMesh(r.props, r.level),
          detailLevel: r.level,
          items: r.items,
          shown: this.hole < 0,
          detail: null,
        }
        built.ground.visible = built.props.visible = built.shown
        this.chunks.set(key, built)
        this.root.add(built.ground, built.props)
        break
      }
      case 'props': {
        if (!chunk || chunk.detailLevel === r.level) return false
        // Swaps a chunk's trees for the full or the simplified ones.
        const props = this.propsMesh(r.props, r.level)
        props.visible = chunk.props.visible
        this.root.remove(chunk.props)
        chunk.props.geometry.dispose()
        chunk.props = props
        chunk.detailLevel = r.level
        this.root.add(props)
        break
      }
      case 'detail': {
        if (!chunk || chunk.detail) return false
        if (chunkDistance(r.cx, r.cz, x, z) > this.tier.detailView + 24) return false
        const group = new THREE.Group()
        group.name = 'ground-detail'
        if (r.main) {
          const mesh = new THREE.Mesh(toGeometry(r.main), this.detailMaterial.main)
          mesh.receiveShadow = true
          group.add(mesh)
        }
        if (r.glow) group.add(new THREE.Mesh(toGeometry(r.glow), this.detailMaterial.glow))
        chunk.detail = group
        this.root.add(group)
        return false
      }
    }
    return d < SHADOW_CHUNKS + CHUNK / 2
  }

  private dropDetail(chunk: Chunk): void {
    if (!chunk.detail) return
    this.root.remove(chunk.detail)
    for (const child of chunk.detail.children) (child as THREE.Mesh).geometry.dispose()
    chunk.detail = null
  }

  private propsMesh(data: GeometryData, level: Detail): THREE.Mesh {
    const simple = level === Detail.Simple
    const props = new THREE.Mesh(toGeometry(data), simple ? this.stillMaterial : this.propMaterial)
    props.castShadow = true
    props.receiveShadow = true
    props.name = simple ? 'forest-simple' : 'forest'
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

import {
  CELL,
  CHUNK,
  CHUNKS,
  GRID,
  hash2,
  type Prop,
  PropKind,
  type Terrain,
  valueNoise,
  WORLD_HALF,
} from '@office-fps/shared'
import * as THREE from 'three'

/**
 * The forest far away, drawn for little: past the chunks Wilds builds in full (see wilds.ts) the
 * ground is one coarse mesh with a hole where the real chunks are, every tree is a flat card that
 * turns to face you (one instanced draw for thousands), and a ring of treeline far out keeps the
 * horizon from looking empty through the day's haze. All of it is rebuilt only when you cross
 * into another chunk.
 */

/** Tree cards and the coarse ground reach this far from the chunk you're in (m). */
export const FAR = 450
/** The coarse ground has a vertex every this many metres (a multiple of CELL). */
const STEP = 16
/** The treeline ring stands this far out (m). */
const WALL = 560
/** Card atlas: one cell per kind of tree, CARD_W × CARD_H metres at CARD_PX texels a metre. */
export const CARD_W = 4.8
export const CARD_H = 7.2
const CARD_PX = 10
/** The tree stands this far above the bottom of its card (its roots sink a little). */
const CARD_FOOT = 0.4
export const TILES = 4
/** Room for every tree in every chunk out to FAR (TREE_GRID² candidate spots a chunk). */
const MAX_CARDS = (Math.ceil(FAR / CHUNK) * 2 + 1) ** 2 * 100

export interface TreeColors {
  bark: THREE.Color
  needles: readonly THREE.Color[]
  needlesDark: readonly THREE.Color[]
  birch: THREE.Color
  birchLeaf: THREE.Color
  dead: THREE.Color
  barkDark: THREE.Color
}

export interface FarHost {
  terrain: Terrain
  groundMaterial: THREE.Material
  /** The ground's own colour at a point (as the near chunks colour it). */
  groundColor(x: number, z: number): THREE.Color
  /** Everything growing in a chunk (chunkProps). */
  props(cx: number, cz: number): readonly Prop[]
}

const css = (c: THREE.Color) => `#${c.getHexString()}`

/** Side views of the trees Wilds builds (pine ×2, birch, dead), painted once. */
function makeCardAtlas(colors: TreeColors): THREE.CanvasTexture {
  const w = Math.round(CARD_W * CARD_PX)
  const h = Math.round(CARD_H * CARD_PX)
  const canvas = document.createElement('canvas')
  canvas.width = w * TILES
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  // Metres (x from the trunk, y up from the roots) to texels in cell `tile`.
  const px = (tile: number, x: number) => tile * w + w / 2 + x * CARD_PX
  const py = (y: number) => h - (y + CARD_FOOT) * CARD_PX
  const poly = (tile: number, color: THREE.Color, points: [number, number][]) => {
    ctx.fillStyle = css(color)
    ctx.beginPath()
    points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(px(tile, x), py(y))
      else ctx.lineTo(px(tile, x), py(y))
    })
    ctx.closePath()
    ctx.fill()
  }
  const rect = (tile: number, color: THREE.Color, x0: number, y0: number, x1: number, y1: number) =>
    poly(tile, color, [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ])

  // Pines: a trunk and three tiers, lit on the left, in shade on the right (as the cones are).
  for (const tile of [0, 1]) {
    const green = colors.needles[tile * 2] as THREE.Color
    const dark = colors.needlesDark[tile * 2] as THREE.Color
    rect(tile, colors.bark, -0.2, -0.4, 0.2, 2)
    for (const [y, height, r] of [
      [1.5, 2.7, 2],
      [3.1, 2.4, 1.55],
      [4.6, 2.2, 1.05],
    ] as const) {
      const half = r * 1.15
      poly(tile, green, [
        [-half, y],
        [0, y],
        [0, y + height],
      ])
      poly(tile, dark, [
        [0, y],
        [half, y],
        [0, y + height],
      ])
    }
  }
  // Birch: a pale trunk with dark marks and two blocks of leaves.
  rect(2, colors.birch, -0.11, -0.4, 0.11, 5.3)
  for (const y of [0.8, 1.9, 2.6, 4.1]) rect(2, colors.barkDark, -0.11, y, 0.05, y + 0.12)
  const leafDark = colors.birchLeaf.clone().multiplyScalar(0.7)
  rect(2, colors.birchLeaf, -0.85, 3.4, 0.1, 4.75)
  rect(2, leafDark, 0.1, 3.4, 0.85, 4.75)
  rect(2, colors.birchLeaf, -0.2, 4.6, 0.5, 5.75)
  rect(2, leafDark, 0.5, 4.6, 1.0, 5.75)
  // Dead tree: a leaning grey trunk and bare branches.
  poly(3, colors.dead, [
    [-0.18, -0.4],
    [0.18, -0.4],
    [0.55, 5.1],
    [0.3, 5.1],
  ])
  for (const [y, dir] of [
    [2.4, -1],
    [3.5, 1],
    [4.6, -1],
  ] as const) {
    const x = (y / 5.1) * 0.4
    poly(3, colors.dead, [
      [x, y],
      [x + 0.12, y + 0.1],
      [x + dir * 1.1 + 0.06, y + 1.3],
      [x + dir * 1.1 - 0.06, y + 1.2],
    ])
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  // Nearest mips: the cards keep their solid edges (alpha test) instead of thinning out.
  texture.minFilter = THREE.NearestMipmapNearestFilter
  return texture
}

/** A geometry with no vertices yet, but these attributes (name: item size). */
function emptyGeometry(attributes: Record<string, number>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  for (const [name, size] of Object.entries(attributes)) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute([], size))
  }
  return geometry
}

/**
 * A band of distant forest, repeating sideways: a soft, rolling canopy behind (red 0.5) and
 * single pines of all heights standing out of it in front (red 1). Alpha is coverage; the red
 * channel says how near a tree stands, for the fog (see treelineMaterial).
 */
function makeTreelineTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 64
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  // Canopy height (0 = bottom, 1 = top) along the band: slow swells and dips, wrapping round.
  const canopy = (x: number) =>
    0.5 +
    0.07 * Math.sin((x / w) * Math.PI * 2 * 3 + 1.3) +
    0.05 * Math.sin((x / w) * Math.PI * 2 * 7 + 0.4)
  const at = (x: number, draw: (x: number) => void) => {
    // Wrap around so the band joins up with itself.
    for (const shift of [0, w, -w]) draw(x + shift)
  }
  // Behind: overlapping round crowns, a blur of forest further on.
  ctx.fillStyle = 'rgb(128, 0, 0)'
  ctx.fillRect(0, h * 0.62, w, h)
  for (let x = 0; x < w; x += 3) {
    const r = 3 + hash2(x, 4, 77) * 4
    const y = h * (1 - canopy(x) + 0.06) + hash2(x, 5, 77) * 3
    at(x, (cx) => {
      ctx.beginPath()
      ctx.ellipse(cx, y, r, r * 1.3, 0, 0, Math.PI * 2)
      ctx.fill()
    })
  }
  // In front: pines, mostly in loose clumps, some well above the canopy.
  ctx.fillStyle = 'rgb(255, 0, 0)'
  ctx.fillRect(0, h * 0.78, w, h)
  for (let x = 0; x < w; ) {
    const clump = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 11 + hash2(x >> 5, 6, 77) * 3)
    const tall = canopy(x) - 0.12 + clump * 0.16 + hash2(x, 1, 77) * 0.12
    const top = h * (1 - tall)
    const half = 2 + hash2(x, 2, 77) * 2.5
    const base = h * 0.82
    at(x, (cx) => {
      // A spire with a ragged edge: three tiers stepping out as they go down.
      ctx.beginPath()
      ctx.moveTo(cx, top)
      for (const [k, out] of [
        [0.3, 0.45],
        [0.55, 0.75],
        [1, 1],
      ] as const) {
        const y = top + (base - top) * k
        ctx.lineTo(cx + half * out, y)
        ctx.lineTo(cx + half * out * 0.55, y - 1)
      }
      for (const [k, out] of [
        [1, 1],
        [0.55, 0.75],
        [0.3, 0.45],
      ] as const) {
        const y = top + (base - top) * k
        ctx.lineTo(cx - half * out * 0.55, y - 1)
        ctx.lineTo(cx - half * out, y)
      }
      ctx.closePath()
      ctx.fill()
    })
    x += 3 + Math.floor(hash2(x, 3, 77) * 5 * (1.4 - clump))
  }
  const texture = new THREE.CanvasTexture(canvas)
  // Data, not colour: the red channel is read as is.
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}

/** Lambert cards that turn about the vertical to face the camera; per card a tile and a shade. */
function cardMaterial(atlas: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 cardPos;
attribute vec2 cardLook;
varying float vCardShade;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
float cardU = cardLook.y < 0.0 ? 1.0 - uv.x : uv.x;
vMapUv = vec2((cardLook.x + cardU) / ${TILES.toFixed(1)}, uv.y);`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 cardFace = normalize(cameraPosition.xz - cardPos.xz + vec2(1e-4, 0.0));
vec3 objectNormal = normalize(vec3(cardFace.x * 0.7, 1.0, cardFace.y * 0.7));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = cardPos.xyz
  + vec3(cardFace.y, 0.0, -cardFace.x) * position.x * cardPos.w * ${CARD_W.toFixed(2)}
  + vec3(0.0, position.y * cardPos.w * ${CARD_H.toFixed(2)}, 0.0);
vCardShade = abs(cardLook.y);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCardShade;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= vCardShade;',
      )
  }
  material.customProgramCacheKey = () => 'tree-card'
  return material
}

/**
 * Basic material, blended at its soft edges, whose fog stops short of hiding it all by day (fog
 * far ≥ ~380 m): the pines in front show a little through the haze, the canopy behind less,
 * and the foot of the band (where it meets the ground beyond the far forest) not at all.
 */
function treelineMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: makeTreelineTexture(),
    color: 0x1e2a1c,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `vec4 treelineTexel = texture2D(map, vMapUv);
  diffuseColor.a *= treelineTexel.a;
  float treelineNear = treelineTexel.r;`,
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  float treelineFog = smoothstep(fogNear, fogFar, vFogDepth);
  // Through the day's haze a faint line of trees; at night (short fog) nothing.
  float treelineDay = smoothstep(170.0, 380.0, fogFar);
  float treelineCap = mix(1.0, mix(0.93, 0.82, treelineNear), treelineDay);
  treelineCap = mix(1.0, treelineCap, smoothstep(0.25, 0.55, vMapUv.y));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, min(treelineFog, treelineCap));
#endif`,
      )
  }
  material.customProgramCacheKey = () => 'treeline'
  return material
}

const N = GRID + 1
const CHUNK_KEY = (cx: number, cz: number) => cx * CHUNKS + cz

/** Tree kinds drawn as cards, and which atlas tile each uses. */
function cardTile(p: Prop): number {
  switch (p.kind) {
    case PropKind.Pine:
      return Math.floor(p.turn * 4) % 2
    case PropKind.Birch:
      return 2
    case PropKind.DeadTree:
      return 3
    default:
      return -1
  }
}

export class FarForest {
  readonly root = new THREE.Group()
  private readonly host: FarHost
  private readonly ground: THREE.Mesh
  private readonly cards: THREE.Mesh
  private readonly cardGeometry = new THREE.InstancedBufferGeometry()
  private readonly cardPos: THREE.InstancedBufferAttribute
  private readonly cardLook: THREE.InstancedBufferAttribute
  private readonly wall: THREE.Mesh
  /** Cards per far chunk: (x, y, z, scale) and (tile, ±shade), 6 floats a tree. */
  private readonly cache = new Map<number, Float32Array>()
  /** The far chunks' cards (row by row), and how near each chunk comes to `centre`. */
  private farChunks: { cards: Float32Array; near: number }[] = []
  /** The same nearnesses, sorted. */
  private nears = new Float32Array(0)
  /** The point the far forest was last laid out around. */
  private readonly centre = new THREE.Vector2()
  /** How many of the nearest far chunks have their cards drawn (-1: refill). */
  private shownChunks = -1

  constructor(host: FarHost, colors: TreeColors) {
    this.host = host
    this.root.name = 'far-forest'

    // Empty until the first rebuild, but with the attributes the shaders read: the start-up
    // warm-up draws hidden things too, and WebGPU warns about any it can't find.
    this.ground = new THREE.Mesh(
      emptyGeometry({ position: 3, normal: 3, color: 3, uv: 2 }),
      host.groundMaterial,
    )
    this.ground.name = 'far-ground'
    // Past the shadows' reach: nothing to cast or catch.
    this.ground.receiveShadow = false

    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
    this.cardGeometry.setIndex(quad.getIndex())
    this.cardGeometry.setAttribute('position', quad.getAttribute('position'))
    this.cardGeometry.setAttribute('normal', quad.getAttribute('normal'))
    this.cardGeometry.setAttribute('uv', quad.getAttribute('uv'))
    this.cardPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 4), 4)
    this.cardLook = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS * 2), 2)
    this.cardPos.setUsage(THREE.DynamicDrawUsage)
    this.cardLook.setUsage(THREE.DynamicDrawUsage)
    this.cardGeometry.setAttribute('cardPos', this.cardPos)
    this.cardGeometry.setAttribute('cardLook', this.cardLook)
    this.cardGeometry.instanceCount = 0
    this.cards = new THREE.Mesh(this.cardGeometry, cardMaterial(makeCardAtlas(colors)))
    this.cards.name = 'tree-cards'
    // The cards are placed in the shader: the geometry's bounds mean nothing.
    this.cards.frustumCulled = false

    this.wall = new THREE.Mesh(emptyGeometry({ position: 3, uv: 2 }), treelineMaterial())
    this.wall.name = 'treeline'
    this.wall.frustumCulled = false
    this.root.add(this.ground, this.cards, this.wall)
  }

  /**
   * Cards and treeline beyond `fogFar` would only be fog: skip them (all of it at night; in rain
   * or fog by day the cards past the fog). (x, z): where you are.
   */
  cull(fogFar: number, holeEdge: number, x: number, z: number): void {
    this.root.visible = fogFar > holeEdge
    this.wall.visible = fogFar > 200
    // Draw the chunks that come nearer than the fog's far end (refilled when that changes).
    const reach = fogFar + Math.hypot(x - this.centre.x, z - this.centre.y)
    const nears = this.nears
    let lo = 0
    let hi = nears.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((nears[mid] as number) < reach) lo = mid + 1
      else hi = mid
    }
    if (lo !== this.shownChunks) this.fillCards(lo)
  }

  /**
   * Everything around chunk (ccx, ccz), out to FAR, except the chunks `inner` says Wilds draws
   * itself.
   */
  rebuild(ccx: number, ccz: number, inner: (cx: number, cz: number) => boolean): void {
    const ox = (ccx + 0.5) * CHUNK - WORLD_HALF
    const oz = (ccz + 0.5) * CHUNK - WORLD_HALF
    this.centre.set(ox, oz)
    this.buildGround(ox, oz, inner)
    this.buildCards(ccx, ccz, inner)
    this.buildWall(ox, oz)
  }

  private height(xi: number, zi: number): number {
    const k = STEP / CELL
    const gx = Math.max(0, Math.min(GRID, xi * k))
    const gz = Math.max(0, Math.min(GRID, zi * k))
    return this.host.terrain.heights[gx * N + gz] as number
  }

  private buildGround(ox: number, oz: number, inner: (cx: number, cz: number) => boolean): void {
    const reach = FAR + CHUNK / 2
    const steps = GRID / (STEP / CELL)
    const i0 = Math.max(0, Math.floor((ox - reach + WORLD_HALF) / STEP))
    const i1 = Math.min(steps, Math.ceil((ox + reach + WORLD_HALF) / STEP))
    const j0 = Math.max(0, Math.floor((oz - reach + WORLD_HALF) / STEP))
    const j1 = Math.min(steps, Math.ceil((oz + reach + WORLD_HALF) / STEP))
    const nj = j1 - j0 + 1
    const position: number[] = []
    const normal: number[] = []
    const color: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      const c = this.host.groundColor(x, z)
      position.push(x, y, z)
      normal.push(nx, ny, nz)
      color.push(c.r, c.g, c.b)
      uv.push(x / 6, z / 6)
      return position.length / 3 - 1
    }
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const dx = this.height(i + 1, j) - this.height(i - 1, j)
        const dz = this.height(i, j + 1) - this.height(i, j - 1)
        const l = Math.hypot(dx, 2 * STEP, dz)
        const x = i * STEP - WORLD_HALF
        const z = j * STEP - WORLD_HALF
        vertex(x, this.height(i, j), z, -dx / l, (2 * STEP) / l, -dz / l)
      }
    }
    const at = (i: number, j: number) => (i - i0) * nj + (j - j0)
    const chunkAt = (i: number) => Math.floor((i * STEP) / CHUNK)
    const holeAt = (i: number, j: number) => inner(chunkAt(i), chunkAt(j))
    const skirt = (a: number, b: number) => {
      // Hang a strip from edge a–b down into the hole: no gaps against the finer chunk edge.
      const pa = [position[a * 3], position[a * 3 + 1], position[a * 3 + 2]] as number[]
      const pb = [position[b * 3], position[b * 3 + 1], position[b * 3 + 2]] as number[]
      const n = [normal[a * 3], normal[a * 3 + 1], normal[a * 3 + 2]] as number[]
      const c = vertex(pa[0] ?? 0, (pa[1] ?? 0) - 3, pa[2] ?? 0, n[0] ?? 0, n[1] ?? 1, n[2] ?? 0)
      const d = vertex(pb[0] ?? 0, (pb[1] ?? 0) - 3, pb[2] ?? 0, n[0] ?? 0, n[1] ?? 1, n[2] ?? 0)
      index.push(a, b, d, a, d, c, a, d, b, a, c, d)
    }
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        const cx = (i + 0.5) * STEP - WORLD_HALF
        const cz = (j + 0.5) * STEP - WORLD_HALF
        if (Math.hypot(cx - ox, cz - oz) > reach || holeAt(i, j)) continue
        const a = at(i, j)
        const b = a + 1
        const c = a + nj
        const d = c + 1
        index.push(a, b, c, c, b, d)
        if (holeAt(i - 1, j)) skirt(a, b)
        if (holeAt(i + 1, j)) skirt(c, d)
        if (holeAt(i, j - 1)) skirt(a, c)
        if (holeAt(i, j + 1)) skirt(b, d)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.setIndex(index)
    geometry.computeBoundingSphere()
    this.ground.geometry.dispose()
    this.ground.geometry = geometry
  }

  /** The cards for one chunk's trees (cached: the forest never changes). */
  private chunkCards(cx: number, cz: number): Float32Array {
    const key = CHUNK_KEY(cx, cz)
    const cached = this.cache.get(key)
    if (cached) return cached
    const out: number[] = []
    for (const p of this.host.props(cx, cz)) {
      const tile = cardTile(p)
      if (tile < 0) continue
      const shade = 0.8 + hash2(Math.round(p.x * 8), Math.round(p.z * 8), 91) * 0.2
      out.push(p.x, p.y - CARD_FOOT * p.scale, p.z, p.scale, tile, p.turn > 0.5 ? -shade : shade)
    }
    const cards = new Float32Array(out)
    this.cache.set(key, cards)
    return cards
  }

  private buildCards(ccx: number, ccz: number, inner: (cx: number, cz: number) => boolean): void {
    const reach = Math.ceil(FAR / CHUNK)
    const keep = new Set<number>()
    this.farChunks = []
    for (let cx = Math.max(0, ccx - reach); cx <= Math.min(CHUNKS - 1, ccx + reach); cx++) {
      for (let cz = Math.max(0, ccz - reach); cz <= Math.min(CHUNKS - 1, ccz + reach); cz++) {
        if (Math.hypot(cx - ccx, cz - ccz) * CHUNK > FAR || inner(cx, cz)) continue
        keep.add(CHUNK_KEY(cx, cz))
        // How near the chunk comes to the centre (its middle, less half its diagonal).
        const near = Math.hypot(cx - ccx, cz - ccz) * CHUNK - CHUNK * Math.SQRT1_2
        this.farChunks.push({ cards: this.chunkCards(cx, cz), near })
      }
    }
    this.nears = Float32Array.from(this.farChunks, (c) => c.near).sort()
    this.fillCards(this.nears.length)
    // Forget chunks well behind (a few chunks' slack, so walking back and forth costs nothing).
    for (const key of this.cache.keys()) {
      if (keep.has(key)) continue
      const cx = Math.floor(key / CHUNKS)
      const cz = key % CHUNKS
      if (Math.hypot(cx - ccx, cz - ccz) * CHUNK > FAR + CHUNK * 3) this.cache.delete(key)
    }
  }

  /**
   * Cards for the `chunks` nearest far chunks. They go in row by row, not nearest first: trees
   * drawn in order of distance hop all over the screen, and take a fifth longer to rasterise.
   */
  private fillCards(chunks: number): void {
    this.shownChunks = chunks
    const cut = chunks > 0 ? (this.nears[chunks - 1] as number) : -Infinity
    const pos = this.cardPos.array as Float32Array
    const look = this.cardLook.array as Float32Array
    let count = 0
    for (const { cards, near } of this.farChunks) {
      if (near > cut) continue
      for (let k = 0; k < cards.length && count < MAX_CARDS; k += 6) {
        pos.set(cards.subarray(k, k + 4), count * 4)
        look[count * 2] = cards[k + 4] as number
        look[count * 2 + 1] = cards[k + 5] as number
        count++
      }
    }
    this.cardGeometry.instanceCount = count
    this.cardPos.clearUpdateRanges()
    this.cardPos.addUpdateRange(0, count * 4)
    this.cardPos.needsUpdate = true
    this.cardLook.clearUpdateRanges()
    this.cardLook.addUpdateRange(0, count * 2)
    this.cardLook.needsUpdate = true
  }

  /** A ring of treetops on the ground WALL metres out, seen faintly through the day's haze. */
  private buildWall(ox: number, oz: number): void {
    const segments = 160
    const repeats = 9
    const position: number[] = []
    const uv: number[] = []
    const index: number[] = []
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2
      const x = ox + Math.cos(a) * WALL
      const z = oz + Math.sin(a) * WALL
      const i = Math.round((x + WORLD_HALF) / STEP)
      const j = Math.round((z + WORLD_HALF) / STEP)
      const y = this.height(i, j)
      // The band's top rises and falls a little (no two repeats of the texture alike).
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const rise = 3 * valueNoise(ca * 4, sa * 4, 41) + 2 * valueNoise(ca * 13, sa * 13, 42)
      position.push(x, y - 14, z, x, y + 14 + rise, z)
      const u = (s / segments) * repeats
      uv.push(u, 0, u, 1)
      if (s > 0) {
        const k = s * 2
        index.push(k - 2, k, k - 1, k - 1, k, k + 1)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.setIndex(index)
    this.wall.geometry.dispose()
    this.wall.geometry = geometry
  }

  dispose(): void {
    this.ground.geometry.dispose()
    this.cardGeometry.dispose()
    this.wall.geometry.dispose()
  }
}

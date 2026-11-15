import * as THREE from 'three'

/**
 * Pixel-art texture helpers that need no DOM (so they're tested, and could run in a worker):
 * the seeded random the painters share, a palette pass that snaps a painted texture to a few
 * shades (crisp detail at the pixel renderer's resolution instead of noise mush), halving the
 * texel density for the Low tier, the two plain-array painters (forest floor, car sheet metal)
 * and metric planar UVs for boxes, so texel density is the same whatever a box's size.
 */

/** Deterministic PRNG so textures look identical on every client. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Pixels = Uint8Array | Uint8ClampedArray

/**
 * Snaps every texel of an RGBA image to one of at most `colors` shades, found by median cut
 * (split the box of colours along its longest channel at the median, the box with most texels
 * first). Deterministic: same pixels in, same pixels out. Fully transparent texels are left be.
 * @returns the palette used
 */
export function quantizePalette(data: Pixels, colors: number): [number, number, number][] {
  const opaque: number[] = []
  for (let i = 0; i < data.length; i += 4) if ((data[i + 3] as number) > 0) opaque.push(i)
  if (opaque.length === 0 || colors < 1) return []
  let boxes: number[][] = [opaque]
  const range = (box: number[], c: number) => {
    let lo = 255
    let hi = 0
    for (const i of box) {
      const v = data[i + c] as number
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo
  }
  while (boxes.length < colors) {
    // The biggest box that still has more than one colour in it.
    let pick = -1
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b] as number[]
      if (box.length < 2 || [0, 1, 2].every((c) => range(box, c) === 0)) continue
      if (pick < 0 || box.length > (boxes[pick] as number[]).length) pick = b
    }
    if (pick < 0) break
    const box = boxes[pick] as number[]
    const ranges = [0, 1, 2].map((c) => range(box, c))
    const c = ranges.indexOf(Math.max(...ranges))
    const sorted = [...box].sort(
      (a, b) => (data[a + c] as number) - (data[b + c] as number) || a - b,
    )
    const half = sorted.length >> 1
    boxes = [
      ...boxes.slice(0, pick),
      sorted.slice(0, half),
      sorted.slice(half),
      ...boxes.slice(pick + 1),
    ]
  }
  const palette = boxes.map((box): [number, number, number] => {
    const sum = [0, 0, 0]
    for (const i of box)
      for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (data[i + c] as number)
    return sum.map((s) => Math.round(s / box.length)) as [number, number, number]
  })
  boxes.forEach((box, b) => {
    const [r, g, bl] = palette[b] as [number, number, number]
    for (const i of box) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = bl
    }
  })
  return palette
}

/**
 * Every `factor`-th texel each way (nearest, no blending: a half-density texture keeps the
 * same palette). `size` is the source's width and height.
 */
export function decimate(
  data: Pixels,
  size: number,
  factor: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = Math.max(1, Math.floor(size / factor))
  const result = new Uint8ClampedArray(out * out * 4)
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const from = (y * factor * size + x * factor) * 4
      result.set(data.subarray(from, from + 4), (y * out + x) * 4)
    }
  }
  return result
}

/** Grey levels (0–255) the forest floor is laid in, a multiplier over the ground's colour (most of it the middle one: as dark on average as the old speckle). */
const FLOOR_SHADES = [118, 150, 176, 196, 218] as const

/**
 * The forest floor's detail as a grey multiplier over the vertex colours: a few flat shades,
 * in features measured in centimetres (so they keep their size at any density) — needles
 * lying crossways, twigs, pebbles with a lit top, tufts of blades and dark hollows under them.
 * @param size texels a side (the texture covers `meters` × `meters`)
 */
export function paintForestFloor(size: number, meters: number, seed: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  const shade = new Uint8Array(size * size).fill(3)
  const tpm = size / meters
  const rand = mulberry32(seed)
  const put = (x: number, y: number, s: number) => {
    const i = (((y % size) + size) % size) * size + (((x % size) + size) % size)
    shade[i] = s
  }
  const px = (cm: number) => Math.max(1, Math.round((cm / 100) * tpm))
  // A loose mottle of slightly darker and lighter litter, in blocks of ~12 cm.
  const block = px(12)
  for (let by = 0; by < size; by += block) {
    for (let bx = 0; bx < size; bx += block) {
      const r = rand()
      const s = r < 0.18 ? 2 : 3
      for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) put(x, y, s)
    }
  }
  const area = meters * meters
  // Dark hollows: damp, shade under the litter.
  for (let i = 0; i < area * 1.6; i++) {
    const x = Math.floor(rand() * size)
    const y = Math.floor(rand() * size)
    const w = px(8 + rand() * 14)
    const h = px(5 + rand() * 8)
    for (let k = 0; k < h; k++) for (let j = 0; j < w; j++) if (rand() < 0.85) put(x + j, y + k, 1)
  }
  // Needles: short straight strokes, lighter than the litter, any of four directions.
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const
  for (let i = 0; i < area * 40; i++) {
    let x = Math.floor(rand() * size)
    let y = Math.floor(rand() * size)
    const [dx, dy] = dirs[Math.floor(rand() * 4)] ?? dirs[0]
    const len = px(4 + rand() * 5)
    const s = rand() < 0.7 ? 4 : 2
    for (let k = 0; k < len; k++) {
      put(x, y, s)
      x += dx
      y += dy
    }
  }
  // Twigs: longer dark strokes with a lit edge.
  for (let i = 0; i < area * 1.4; i++) {
    let x = Math.floor(rand() * size)
    let y = Math.floor(rand() * size)
    const steep = rand() < 0.5
    const len = px(14 + rand() * 20)
    for (let k = 0; k < len; k++) {
      put(x, y, 0)
      put(steep ? x + 1 : x, steep ? y : y - 1, 4)
      if (steep) {
        y++
        if (rand() < 0.3) x += rand() < 0.5 ? -1 : 1
      } else {
        x++
        if (rand() < 0.3) y += rand() < 0.5 ? -1 : 1
      }
    }
  }
  // Pebbles: a dark underside, a lit top.
  for (let i = 0; i < area * 2.2; i++) {
    const x = Math.floor(rand() * size)
    const y = Math.floor(rand() * size)
    const w = px(3 + rand() * 4)
    const h = Math.max(1, w - 1)
    for (let k = 0; k < h; k++) for (let j = 0; j < w; j++) put(x + j, y + k, k === 0 ? 4 : 3)
    for (let j = 0; j < w; j++) put(x + j, y + h, 0)
  }
  // Tufts: a few upright blades, lit, with a hollow at the root.
  for (let i = 0; i < area * 1.2; i++) {
    const x = Math.floor(rand() * size)
    const y = Math.floor(rand() * size)
    const blades = 3 + Math.floor(rand() * 3)
    for (let b = 0; b < blades; b++) {
      const bx = x + b * px(2) - px(3)
      const tall = px(4 + rand() * 6)
      for (let k = 0; k < tall; k++) put(bx + (k > tall / 2 && b % 2 ? 1 : 0), y - k, 4)
      put(bx, y + 1, 1)
    }
  }
  for (let i = 0; i < size * size; i++) {
    const v = FLOOR_SHADES[shade[i] as number] as number
    data.set([v, v, v, 255], i * 4)
  }
  return data
}

/**
 * Worn sheet metal for the cars, as a near-white multiplier over each part's colour: chips
 * through the paint, scratches, pitting and grime gathering in the lower rows.
 */
export function paintSheetMetal(size: number, seed: number): Uint8Array {
  const shades = [255, 236, 214, 182, 140] as const
  const shade = new Uint8Array(size * size)
  const rand = mulberry32(seed)
  const put = (x: number, y: number, s: number) => {
    const i = (((y % size) + size) % size) * size + (((x % size) + size) % size)
    if (s > (shade[i] as number)) shade[i] = s
  }
  // Faint brushing and dirt in long rows.
  for (let y = 0; y < size; y++) {
    if (rand() < 0.35) for (let x = 0; x < size; x++) if (rand() < 0.6) put(x, y, 1)
  }
  // Scratches: thin lines, mostly level.
  for (let i = 0; i < size / 3; i++) {
    let x = Math.floor(rand() * size)
    let y = Math.floor(rand() * size)
    const len = 3 + Math.floor(rand() * (size / 4))
    for (let k = 0; k < len; k++) {
      put(x, y, 2)
      x++
      if (rand() < 0.15) y += rand() < 0.5 ? -1 : 1
    }
  }
  // Chips and pits: a dark heart in a lighter ring.
  for (let i = 0; i < size / 2; i++) {
    const x = Math.floor(rand() * size)
    const y = Math.floor(rand() * size)
    put(x, y, 4)
    put(x + 1, y, 3)
    put(x, y + 1, 3)
    if (rand() < 0.5) put(x - 1, y, 2)
  }
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const v = shades[shade[i] as number] as number
    data.set([v, v, v, 255], i * 4)
  }
  return data
}

/**
 * Planar UVs in metres: each face projected on its dominant axis (tops on x/z, sides on z/y
 * or x/y), so a texture repeating every N metres keeps its texel density on any box. Built in
 * world coordinates (the map) the grid lines up across boxes; in a part's own coordinates (a
 * car) it's uniform across that part.
 */
export function planarUVs(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  let uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2)
    geometry.setAttribute('uv', uv)
  }
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(normal.getX(i))
    const ny = Math.abs(normal.getY(i))
    const nz = Math.abs(normal.getZ(i))
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (ny >= nx && ny >= nz) uv.setXY(i, x, z)
    else if (nx >= nz) uv.setXY(i, z, y)
    else uv.setXY(i, x, y)
  }
  uv.needsUpdate = true
}

/** A texture from plain RGBA texels, repeating, sRGB, every `meters` metres in metric UVs. */
export function dataTexture(data: Uint8Array, size: number, meters: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = true
  texture.repeat.set(1 / meters, 1 / meters)
  texture.needsUpdate = true
  return texture
}

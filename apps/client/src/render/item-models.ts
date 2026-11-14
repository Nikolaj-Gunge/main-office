import { ITEMS, type ItemKind } from '@office-fps/shared'
import * as THREE from 'three'
import { buildGunModel } from './gun-models.ts'

/**
 * What every survival item looks like lying about: a few boxes and eight-sided cylinders, at
 * real size, in the colours of its inventory icon (hud/item-icons.ts) so a thing reads the same
 * in the grid and on the shelf. Each model is one merged, cached triangle list; colours come
 * from a small shared palette texture, so every item in the world draws with one material and
 * loot-view.ts can merge whole neighbourhoods of loot into a single mesh.
 *
 * Models rest on y = 0 and are centred on x/z.
 */

/** One item's triangles (not indexed), ready to be copied into a merged mesh. */
export interface ItemModel {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** Width, height, depth (m). */
  size: [number, number, number]
}

// --- The palette ---------------------------------------------------------------------------

const PALETTE_SIZE = 512
const paletteData = new Uint8Array(PALETTE_SIZE * 4)
const paletteIndex = new Map<number, number>()

/** Every item colour, one texel each (sRGB, like the icons' hex codes). */
const palette = new THREE.DataTexture(paletteData, PALETTE_SIZE, 1)
palette.colorSpace = THREE.SRGBColorSpace
palette.magFilter = THREE.NearestFilter
palette.minFilter = THREE.NearestFilter
palette.generateMipmaps = false

/** The palette u for a colour (registered on first use). */
function paletteU(color: number): number {
  let i = paletteIndex.get(color)
  if (i === undefined) {
    i = Math.min(paletteIndex.size, PALETTE_SIZE - 1)
    paletteIndex.set(color, i)
    paletteData[i * 4] = (color >> 16) & 255
    paletteData[i * 4 + 1] = (color >> 8) & 255
    paletteData[i * 4 + 2] = color & 255
    paletteData[i * 4 + 3] = 255
    palette.needsUpdate = true
  }
  return (i + 0.5) / PALETTE_SIZE
}

/**
 * The one material for everything lying about. Lit like the rest of the world, plus a faint
 * glow of its own colour: just enough to find things in the dark when you look for them.
 */
export const ITEM_MATERIAL = new THREE.MeshLambertMaterial({
  map: palette,
  emissiveMap: palette,
  emissive: 0xffffff,
  emissiveIntensity: 0.22,
  flatShading: true,
})

// --- Building blocks -----------------------------------------------------------------------

interface At {
  x?: number
  /** The bottom of the part (before tilting). */
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _one = new THREE.Vector3(1, 1, 1)

/** Collects parts, then welds them into one ItemModel. */
class Kit {
  private readonly parts: { geo: THREE.BufferGeometry; u: number }[] = []

  private place(geo: THREE.BufferGeometry, color: number, at: At, centreY: number): this {
    _e.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0)
    _q.setFromEuler(_e)
    _p.set(at.x ?? 0, (at.y ?? 0) + centreY, at.z ?? 0)
    _m.compose(_p, _q, _one)
    const flat = geo.index ? geo.toNonIndexed() : geo
    flat.applyMatrix4(_m)
    this.parts.push({ geo: flat, u: paletteU(color) })
    return this
  }

  /** A box, `at.y` its bottom. */
  box(w: number, h: number, d: number, color: number, at: At = {}): this {
    return this.place(new THREE.BoxGeometry(w, h, d), color, at, h / 2)
  }

  /**
   * An eight-sided cylinder. Upright (`axis` y): `at.y` is its bottom. Lying along x or z:
   * `at.y` is where it touches the ground.
   */
  cyl(r: number, h: number, color: number, at: At = {}, axis: 'x' | 'y' | 'z' = 'y', sides = 8) {
    const geo = new THREE.CylinderGeometry(r, r, h, sides)
    if (axis === 'x') geo.rotateZ(Math.PI / 2)
    if (axis === 'z') geo.rotateX(Math.PI / 2)
    return this.place(geo, color, at, axis === 'y' ? h / 2 : r)
  }

  /** A flat ring of eight boxes (duct tape, a ring, a necklace), `at.y` its bottom. */
  ring(rOut: number, rIn: number, h: number, color: number, at: At = {}, sides = 8): this {
    const mid = (rOut + rIn) / 2
    const len = 2 * rOut * Math.tan(Math.PI / sides) + 0.001
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      const geo = new THREE.BoxGeometry(len, h, rOut - rIn)
      geo.translate(0, 0, mid)
      geo.rotateY(a)
      this.place(geo, color, at, h / 2)
    }
    return this
  }

  /** Bakes a ready-made model (the guns) in, keeping its materials' colours. */
  object(root: THREE.Object3D): this {
    root.updateMatrixWorld(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshLambertMaterial
      const geo = mesh.geometry.clone()
      geo.applyMatrix4(mesh.matrixWorld)
      const flat = geo.index ? geo.toNonIndexed() : geo
      this.parts.push({ geo: flat, u: paletteU(material.color?.getHex() ?? 0x808080) })
      mesh.geometry.dispose()
    })
    return this
  }

  build(): ItemModel {
    let count = 0
    for (const { geo } of this.parts) count += geo.getAttribute('position').count
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    let v = 0
    for (const { geo, u } of this.parts) {
      const pos = geo.getAttribute('position')
      const nrm = geo.getAttribute('normal')
      for (let i = 0; i < pos.count; i++, v++) {
        positions[v * 3] = pos.getX(i)
        positions[v * 3 + 1] = pos.getY(i)
        positions[v * 3 + 2] = pos.getZ(i)
        normals[v * 3] = nrm.getX(i)
        normals[v * 3 + 1] = nrm.getY(i)
        normals[v * 3 + 2] = nrm.getZ(i)
        uvs[v * 2] = u
        uvs[v * 2 + 1] = 0.5
      }
      geo.dispose()
    }
    // Rest on the ground, centred where it lies.
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i++) {
      const a = i % 3
      const p = positions[i] ?? 0
      if (p < (min[a] ?? 0)) min[a] = p
      if (p > (max[a] ?? 0)) max[a] = p
    }
    const shift = [
      -((min[0] ?? 0) + (max[0] ?? 0)) / 2,
      -(min[1] ?? 0),
      -((min[2] ?? 0) + (max[2] ?? 0)) / 2,
    ]
    for (let i = 0; i < positions.length; i++)
      positions[i] = (positions[i] ?? 0) + (shift[i % 3] ?? 0)
    const size: [number, number, number] = count
      ? [
          (max[0] ?? 0) - (min[0] ?? 0),
          (max[1] ?? 0) - (min[1] ?? 0),
          (max[2] ?? 0) - (min[2] ?? 0),
        ]
      : [0, 0, 0]
    return { positions, normals, uvs, size }
  }
}

// --- Colours (as the icons) ----------------------------------------------------------------

const STEEL = 0xa8acb0
const LID = 0xd0d4d8
const DARK = 0x24262a
const GUNMETAL = 0x3b3e44
const WOOD = 0x7a4f2c
const WOOD_LIGHT = 0x9a6a3c
const CREAM = 0xe8dcc0
const WHITE = 0xe8e8e8
const BRASS = 0xc8a040

// --- Shapes ----------------------------------------------------------------------------------

type Build = (k: Kit) => void

/** A tin can: steel ends, a paper label round the middle. */
function can(label: string | number, r: number, h: number, lid = LID): Build {
  const color = typeof label === 'string' ? Number.parseInt(label.slice(1), 16) : label
  return (k) => {
    k.cyl(r, h, STEEL)
      .cyl(r + 0.002, h * 0.8, color, { y: h * 0.1 })
      .cyl(r * 0.8, 0.004, lid, { y: h })
  }
}

/** A bottle: body, shoulder, neck and cap, and a label if it has one. */
function bottle(
  glass: number,
  cap: number,
  o: { r?: number; h?: number; label?: number; neck?: number } = {},
): Build {
  const r = o.r ?? 0.033
  const h = o.h ?? 0.2
  const body = h * 0.66
  const neck = o.neck ?? h * 0.2
  return (k) => {
    k.cyl(r, body, glass)
      .cyl(r * 0.7, h * 0.08, glass, { y: body })
      .cyl(r * 0.38, neck, glass, { y: body + h * 0.08 })
      .cyl(r * 0.45, h * 0.06, cap, { y: body + h * 0.08 + neck })
    if (o.label !== undefined) k.cyl(r + 0.002, body * 0.45, o.label, { y: body * 0.25 })
  }
}

/** A small pill bottle with a cap. */
function pills(body: number, cap: number): Build {
  return (k) => {
    k.cyl(0.022, 0.06, body)
      .cyl(0.024, 0.018, cap, { y: 0.06 })
      .cyl(0.0225, 0.025, WHITE, { y: 0.018 })
  }
}

/** A carton or packet: a box with a band round it. */
function carton(
  w: number,
  h: number,
  d: number,
  color: number,
  band?: number,
  bandH = 0.35,
): Build {
  return (k) => {
    k.box(w, h, d, color)
    if (band !== undefined)
      k.box(w + 0.002, h * bandH, d + 0.002, band, { y: h * (0.5 - bandH / 2) })
  }
}

/** A flat bag lying down (chips, jerky, an MRE): crimped seals at both ends. */
function bag(w: number, h: number, d: number, color: number, band?: number): Build {
  return (k) => {
    k.box(w, h, d * 0.86, color, { z: 0 })
      .box(w * 0.86, h * 0.7, d * 0.97, color, { y: h * 0.15 })
      .box(w + 0.006, 0.012, 0.022, color, { y: h * 0.4, z: d / 2 - 0.011 })
      .box(w + 0.006, 0.012, 0.022, color, { y: h * 0.4, z: -d / 2 + 0.011 })
    if (band !== undefined) k.box(w + 0.002, h + 0.002, d * 0.28, band, { y: -0.001 })
  }
}

/** A box of cartridges, coloured by calibre, with a printed band and a peek of brass. */
function ammoBox(w: number, h: number, d: number, color: number, band: number): Build {
  return (k) => {
    k.box(w, h, d, color)
      .box(w + 0.002, h * 0.3, d + 0.002, band, { y: h * 0.35 })
      .box(w * 0.92, 0.004, d * 0.2, BRASS, { y: h, z: d * 0.3 })
  }
}

/** Clothes folded into a square pile. */
function folded(color: number, o: { trim?: number; hood?: boolean; collar?: number } = {}): Build {
  const w = 0.28
  const d = 0.24
  return (k) => {
    k.box(w, 0.035, d, color)
      .box(w * 0.94, 0.03, d * 0.92, color, { y: 0.035 })
      .box(w * 0.94, 0.004, 0.012, o.collar ?? darker(color), { y: 0.065, z: -d / 2 + 0.03 })
    if (o.trim !== undefined) k.box(w + 0.002, 0.012, d * 0.14, o.trim, { y: 0.028, z: d * 0.18 })
    if (o.hood) k.box(w * 0.5, 0.025, 0.08, color, { y: 0.065, z: -d / 2 + 0.05 })
  }
}

/** A vest laid flat: thicker, with pouches or a printed panel. */
function vest(color: number, panel: number, pouches: boolean): Build {
  return (k) => {
    k.box(0.36, 0.05, 0.42, color).box(0.14, 0.012, 0.1, darker(color), { y: 0.05, z: -0.17 })
    if (pouches) {
      for (const x of [-0.11, 0, 0.11]) k.box(0.08, 0.05, 0.1, panel, { x, y: 0.05, z: 0.08 })
    } else k.box(0.362, 0.014, 0.06, panel, { y: 0.03, z: 0.06 })
  }
}

/** Trousers folded in half and half again. */
function trousers(color: number, pocket?: number): Build {
  return (k) => {
    k.box(0.26, 0.04, 0.3, color)
      .box(0.25, 0.03, 0.28, color, { y: 0.04 })
      .box(0.262, 0.012, 0.04, darker(color), { y: 0.055, z: -0.13 })
    if (pocket !== undefined) {
      k.box(0.07, 0.006, 0.08, pocket, { x: -0.07, y: 0.07, z: 0.02 })
      k.box(0.07, 0.006, 0.08, pocket, { x: 0.07, y: 0.07, z: 0.02 })
    }
  }
}

/** A pair of shoes side by side. `high`: the shaft above the ankle (m). */
function shoes(color: number, sole: number, high: number): Build {
  return (k) => {
    for (const x of [-0.06, 0.06]) {
      k.box(0.1, 0.025, 0.28, sole, { x })
        .box(0.09, 0.07, 0.22, color, { x, y: 0.025, z: 0.02 })
        .box(0.08, 0.03, 0.08, color, { x, y: 0.065, z: -0.07 })
      if (high > 0) k.box(0.09, high, 0.11, color, { x, y: 0.09, z: 0.06 })
      k.box(0.03, 0.004, 0.1, darker(color), { x, y: 0.095, z: -0.04 })
    }
  }
}

/** A backpack standing up: body, top flap, front pocket, straps behind. */
function backpack(
  color: number,
  strap: number,
  w: number,
  h: number,
  d: number,
  extra?: Build,
): Build {
  return (k) => {
    k.box(w, h * 0.85, d, color)
      .box(w * 0.86, h * 0.1, d * 0.9, color, { y: h * 0.85 })
      .box(w * 0.9, h * 0.3, d * 0.3, darker(color), { y: h * 0.62, z: d * 0.52 })
      .box(w * 0.7, h * 0.32, d * 0.3, color, { y: h * 0.1, z: d * 0.6 })
      .box(w * 0.3, h * 0.05, 0.015, strap, { y: h * 0.95 })
    for (const x of [-w * 0.28, w * 0.28]) {
      k.box(0.05, h * 0.7, 0.02, strap, { x, y: h * 0.1, z: -d / 2 - 0.01 })
    }
    extra?.(k)
  }
}

/** A cap, beanie or helmet: a dome made of stacked boxes. */
function dome(color: number, w: number, h: number, d: number, brim?: 'front' | 'all'): Build {
  return (k) => {
    k.box(w, h * 0.55, d, color)
      .box(w * 0.86, h * 0.3, d * 0.86, color, { y: h * 0.55 })
      .box(w * 0.6, h * 0.15, d * 0.6, color, { y: h * 0.85 })
    if (brim === 'front') k.box(w * 0.85, 0.012, d * 0.45, color, { z: d * 0.6 })
    if (brim === 'all') k.box(w * 1.2, 0.012, d * 1.18, color)
  }
}

function darker(color: number, by = 0.6): number {
  const r = Math.round(((color >> 16) & 255) * by)
  const g = Math.round(((color >> 8) & 255) * by)
  const b = Math.round((color & 255) * by)
  return (r << 16) | (g << 8) | b
}

// --- Every item --------------------------------------------------------------------------

const MODELS: Record<string, Build> = {
  // Food
  beans: can(0xc06a2a, 0.038, 0.11),
  soup: can(0xb8302a, 0.038, 0.105),
  tuna: can(0x3a6aa8, 0.043, 0.04),
  peaches: can(0xe0b030, 0.042, 0.115),
  dogfood: can(0x7a5a3a, 0.046, 0.12),
  chips: bag(0.18, 0.05, 0.26, 0xe0c030, 0xc03028),
  chocolate: carton(0.16, 0.014, 0.065, 0x5a3a22, 0xc8c0b0, 1),
  jerky: bag(0.13, 0.025, 0.19, 0x6a2a20, 0xc8a868),
  energybar: carton(0.13, 0.02, 0.04, 0x2a5aa8, 0xe0e0e0, 1),
  mre: bag(0.16, 0.045, 0.26, 0xa08a5a, 0x6a5a3a),
  apple: (k) => {
    k.cyl(0.036, 0.06, 0xb82a24, { y: 0.008 })
      .cyl(0.028, 0.008, 0xb82a24)
      .cyl(0.026, 0.008, 0xb82a24, { y: 0.068 })
      .box(0.005, 0.02, 0.005, 0x4a3a20, { y: 0.07 })
      .box(0.02, 0.003, 0.01, 0x4a8a2a, { x: 0.01, y: 0.078 })
  },
  cereal: (k) => {
    k.box(0.19, 0.27, 0.06, 0xd84a2a)
      .box(0.15, 0.08, 0.062, 0xf0d040, { y: 0.15 })
      .box(0.09, 0.05, 0.063, 0xf0ece0, { x: 0.02, y: 0.04 })
  },
  berries: (k) => {
    k.box(0.1, 0.004, 0.07, 0x3a6a2a)
    for (const [x, z, y] of [
      [-0.02, -0.01, 0],
      [0.015, -0.015, 0],
      [0, 0.015, 0],
      [-0.025, 0.02, 0],
      [0.028, 0.012, 0],
      [0.002, 0, 0.012],
    ] as const)
      k.box(0.016, 0.016, 0.016, 0x5a2a7a, { x, y: 0.004 + y, z, ry: x * 40 })
  },
  // Drink
  water: bottle(0x8ac0e8, 0x2a6ab0, { r: 0.034, h: 0.22, label: 0x2a6ab0 }),
  soda: can(0xc02a2a, 0.033, 0.122),
  energydrink: can(0x3ab03a, 0.029, 0.16, 0xa0a0a0),
  juice: (k) => {
    k.box(0.065, 0.1, 0.04, 0xe0a030)
      .box(0.067, 0.03, 0.042, 0x60a040, { y: 0.04 })
      .box(0.005, 0.04, 0.005, WHITE, { x: 0.018, y: 0.1, rz: 0.3 })
  },
  coffee: (k) => {
    k.cyl(0.04, 0.24, 0x3a4a3a)
      .cyl(0.043, 0.06, 0x8a8a8a, { y: 0.24 })
      .cyl(0.041, 0.012, 0x8a8a8a, { y: 0.03 })
  },
  beer: bottle(0x6a3a12, 0xc8a040, { r: 0.031, h: 0.24, label: CREAM, neck: 0.07 }),
  dirtywater: bottle(0x7a8a5a, 0x5a5a4a, { r: 0.034, h: 0.22 }),
  whiskey: (k) => {
    k.box(0.08, 0.17, 0.055, 0xb0701a)
      .box(0.082, 0.07, 0.057, CREAM, { y: 0.05 })
      .box(0.06, 0.02, 0.04, 0xb0701a, { y: 0.17 })
      .cyl(0.012, 0.05, 0xb0701a, { y: 0.19 })
      .cyl(0.016, 0.025, 0x2a1a10, { y: 0.24 })
  },
  // Medical
  rags: (k) => {
    k.box(0.2, 0.025, 0.15, 0xd8d0c0, { ry: 0.2 })
      .box(0.16, 0.025, 0.12, 0xc8c0b0, { y: 0.022, ry: -0.3, x: 0.02 })
      .box(0.1, 0.02, 0.08, 0xd8d0c0, { y: 0.044, ry: 0.5, x: -0.02 })
  },
  bandage: (k) => {
    k.cyl(0.03, 0.07, 0xf0ece0, {}, 'x')
      .cyl(0.012, 0.072, 0xc8c0b0, { y: 0.018 }, 'x')
      .box(0.065, 0.004, 0.08, 0xf0ece0, { z: 0.05 })
  },
  medkit: (k) => {
    k.box(0.26, 0.1, 0.18, 0xe8e8e8)
      .box(0.262, 0.012, 0.182, 0xb8b8b8, { y: 0.07 })
      .box(0.08, 0.004, 0.024, 0xc82a24, { y: 0.1 })
      .box(0.024, 0.004, 0.08, 0xc82a24, { y: 0.1 })
      .box(0.08, 0.02, 0.014, DARK, { y: 0.04, z: 0.096 })
  },
  painkillers: pills(0xe08a2a, 0xf0f0f0),
  antibiotics: pills(0xe0e0e0, 0x3a8a3a),
  adrenaline: (k) => {
    k.cyl(0.009, 0.1, 0xc8e0f0, {}, 'x')
      .cyl(0.0095, 0.04, 0xe04040, { x: 0.01 }, 'x')
      .box(0.006, 0.03, 0.03, DARK, { x: -0.052, y: 0.002 })
      .cyl(0.003, 0.03, DARK, { x: -0.068, y: 0.006 }, 'x')
      .cyl(0.0015, 0.03, STEEL, { x: 0.065, y: 0.0075 }, 'x')
  },
  cure: (k) => {
    k.box(0.12, 0.03, 0.06, 0x2a2c30)
      .cyl(0.011, 0.07, 0x3ad0d0, { y: 0.02 })
      .cyl(0.012, 0.015, 0xc8c8c8, { y: 0.09 })
  },
  // Backpacks
  pack_school: backpack(0x2a5aa8, 0x1a2a4a, 0.28, 0.4, 0.14),
  pack_hiking: backpack(0xc8602a, 0x3a2a1a, 0.32, 0.6, 0.2, (k) => {
    k.cyl(0.07, 0.36, 0x3a5a3a, { y: 0.6 }, 'x').box(0.36, 0.03, 0.03, 0x8a8a8a, { z: -0.11 })
  }),
  pack_military: backpack(0x5a6a3a, 0x2a3020, 0.36, 0.52, 0.24, (k) => {
    for (const x of [-0.21, 0.21]) k.box(0.06, 0.2, 0.14, 0x4a5a30, { x, y: 0.08 })
  }),
  // Clothes
  cap: (k) => {
    dome(0x2a4a8a, 0.18, 0.1, 0.19, 'front')(k)
    k.box(0.03, 0.01, 0.03, 0xe8e0d0, { y: 0.1 })
  },
  beanie: (k) => {
    dome(0x22252a, 0.19, 0.13, 0.19)(k)
    k.box(0.196, 0.04, 0.196, 0x2c3036)
  },
  bandana: (k) => {
    k.box(0.16, 0.012, 0.16, 0xb82a24, { ry: 0.6 })
      .box(0.02, 0.003, 0.02, 0xe8e0d0, { x: 0.03, y: 0.012 })
      .box(0.02, 0.003, 0.02, 0xe8e0d0, { x: -0.04, y: 0.012, z: 0.02 })
  },
  cowboyhat: (k) => {
    k.box(0.38, 0.014, 0.32, 0x8a5a30)
      .box(0.2, 0.09, 0.16, 0x8a5a30, { y: 0.012 })
      .box(0.17, 0.03, 0.12, 0x8a5a30, { y: 0.1 })
      .box(0.204, 0.022, 0.164, 0x3a2414, { y: 0.02 })
  },
  hardhat: dome(0xe0b020, 0.22, 0.13, 0.26, 'all'),
  helmet: (k) => {
    dome(0x4a5a3a, 0.24, 0.16, 0.27)(k)
    k.box(0.25, 0.02, 0.28, 0x3a4a2e).box(0.04, 0.03, 0.03, DARK, { y: 0.1, z: 0.13 })
  },
  gasmask: (k) => {
    k.box(0.16, 0.06, 0.18, 0x3a3e38)
      .box(0.13, 0.03, 0.12, 0x3a3e38, { y: 0.06, z: -0.02 })
      .cyl(0.026, 0.012, 0x7ab0c8, { x: -0.04, y: 0.085, z: -0.03 })
      .cyl(0.026, 0.012, 0x7ab0c8, { x: 0.04, y: 0.085, z: -0.03 })
      .cyl(0.04, 0.05, DARK, { y: 0.0, z: 0.11 }, 'z')
      .box(0.17, 0.012, 0.03, 0x2a2c28, { y: 0.03, z: -0.08 })
  },
  hoodie: folded(0x4a4e58, { hood: true }),
  flannel: (k) => {
    folded(0xa82a24, { collar: 0x3a1a14 })(k)
    for (const z of [-0.06, 0.02, 0.1]) k.box(0.27, 0.004, 0.014, 0x3a1a14, { y: 0.065, z })
  },
  raincoat: folded(0xe0c020, { hood: true }),
  jacket: folded(0x3a2a20, { trim: 0x5a4030, collar: 0x5a4030 }),
  camojacket: (k) => {
    folded(0x5a6a3a, { trim: 0x3a4428 })(k)
    k.box(0.06, 0.004, 0.05, 0x3a4428, { x: -0.06, y: 0.065, z: 0.03 })
    k.box(0.05, 0.004, 0.06, 0x7a6a4a, { x: 0.07, y: 0.065, z: -0.02 })
  },
  policevest: vest(0x1a2a4a, 0xd0d0d0, false),
  militaryvest: vest(0x4a5236, 0x3a4428, true),
  jeans: trousers(0x2a4a7a),
  cargopants: trousers(0x6a6a4a, 0x5a5a3a),
  camopants: (k) => {
    trousers(0x5a6a3a, 0x3a4428)(k)
    k.box(0.05, 0.004, 0.06, 0x7a6a4a, { x: 0.02, y: 0.07, z: -0.08 })
  },
  worktrousers: trousers(0x8a6a3a, 0x3a3a3a),
  policetrousers: (k) => {
    trousers(0x1a2440)(k)
    k.box(0.012, 0.004, 0.28, 0xd0c060, { x: 0.12, y: 0.07 })
  },
  sneakers: shoes(0xe8e8e8, 0x3a3a3a, 0),
  boots: shoes(0x6a4a2a, 0x2a1a10, 0.06),
  militaryboots: shoes(0x2a2a26, 0x111111, 0.12),
  // Tools and junk
  batteries: (k) => {
    for (const x of [-0.014, 0.014]) {
      k.cyl(0.0125, 0.04, 0xc8a030, { x })
        .cyl(0.0127, 0.014, 0x2a2a2a, { x, y: 0.04 })
        .cyl(0.005, 0.004, STEEL, { x, y: 0.054 })
    }
  },
  scrap: (k) => {
    k.box(0.32, 0.012, 0.18, 0x6a6a6a, { ry: 0.3 })
      .box(0.18, 0.04, 0.12, 0x8a7a6a, { x: 0.04, y: 0.012, ry: -0.4 })
      .box(0.24, 0.01, 0.1, 0x5a5e64, { x: -0.05, y: 0.012, z: 0.06, ry: 1.1, rz: 0.15 })
      .cyl(0.015, 0.22, 0x7a4a3a, { z: -0.06, y: 0.012, ry: 0.5 }, 'x')
  },
  ducttape: (k) => {
    k.ring(0.055, 0.034, 0.05, 0x8a8e94).ring(0.034, 0.03, 0.05, 0xa08060)
  },
  electronics: (k) => {
    k.box(0.16, 0.008, 0.11, 0x2a6a3a)
      .box(0.03, 0.01, 0.03, DARK, { x: -0.04, y: 0.008 })
      .box(0.04, 0.008, 0.02, DARK, { x: 0.03, y: 0.008, z: 0.02 })
      .box(0.01, 0.02, 0.01, BRASS, { x: 0.05, y: 0.008, z: -0.03 })
      .box(0.12, 0.004, 0.004, BRASS, { y: 0.008, z: 0.045 })
      .cyl(0.004, 0.14, 0xb83a2a, { y: 0.008, z: -0.035, ry: 0.4 }, 'x')
  },
  cigarettes: (k) => {
    k.box(0.055, 0.085, 0.022, 0xe8e8e8)
      .box(0.057, 0.025, 0.024, 0xc02a2a, { y: 0.06 })
      .box(0.03, 0.012, 0.003, 0x1a1a1a, { y: 0.02, z: 0.011 })
  },
  lighter: (k) => {
    k.box(0.025, 0.06, 0.012, 0x3a6ac0).box(0.024, 0.012, 0.012, STEEL, { y: 0.06 })
  },
  planks: (k) => {
    k.box(0.12, 0.025, 0.9, WOOD_LIGHT, { x: -0.07 })
      .box(0.12, 0.025, 0.86, WOOD, { x: 0.065, z: 0.02 })
      .box(0.12, 0.025, 0.88, WOOD_LIGHT, { y: 0.025, ry: 0.06 })
  },
  watch: (k) => {
    k.box(0.022, 0.006, 0.2, 0x3a2a20)
      .cyl(0.02, 0.012, 0xc8c0a0, { y: 0.004 })
      .cyl(0.016, 0.002, 0xf0ece0, { y: 0.016 })
      .box(0.002, 0.001, 0.012, DARK, { y: 0.018, z: -0.005 })
  },
  ring: (k) => {
    k.box(0.05, 0.035, 0.05, 0x6a1a24)
      .box(0.052, 0.012, 0.052, 0x4a1218, { y: 0.03 })
      .ring(0.011, 0.008, 0.004, 0xe0b030, { y: 0.042 })
  },
  necklace: (k) => {
    k.ring(0.045, 0.041, 0.004, 0xc8ccd2).box(0.014, 0.004, 0.018, 0xc8ccd2, { z: 0.055 })
  },
  toolkit: (k) => {
    k.box(0.3, 0.08, 0.18, 0xb8302a)
      .box(0.302, 0.012, 0.182, 0x3a3a3a, { y: 0.05 })
      .box(0.1, 0.012, 0.016, 0x3a3a3a, { y: 0.03, z: 0.096 })
      .box(0.02, 0.02, 0.006, STEEL, { x: -0.1, y: 0.04, z: 0.092 })
      .box(0.02, 0.02, 0.006, STEEL, { x: 0.1, y: 0.04, z: 0.092 })
  },
  gasoline: (k) => {
    k.box(0.16, 0.36, 0.34, 0xb82a24)
      .box(0.166, 0.03, 0.2, 0x9a2420, { y: 0.16, rx: 0.8 })
      .box(0.166, 0.03, 0.2, 0x9a2420, { y: 0.16, rx: -0.8 })
      .box(0.03, 0.04, 0.22, DARK, { y: 0.36, z: -0.03 })
      .box(0.03, 0.02, 0.02, DARK, { y: 0.36, z: -0.13 })
      .box(0.03, 0.02, 0.02, DARK, { y: 0.36, z: 0.07 })
      .cyl(0.02, 0.05, DARK, { y: 0.34, z: 0.13, rx: 0.4 })
  },
  cash: (k) => {
    k.box(0.156, 0.02, 0.066, 0x5a9a4a)
      .box(0.156, 0.02, 0.066, 0x5a9a4a, { y: 0.02, ry: 0.15 })
      .box(0.03, 0.042, 0.068, 0xe8dcc0, { ry: 0.08 })
  },
  // Quest things
  radio_tube: (k) => {
    k.cyl(0.02, 0.016, 0x3a3a3a)
      .cyl(0.017, 0.07, 0xd8d0c0, { y: 0.016 })
      .cyl(0.008, 0.012, 0xd8d0c0, { y: 0.086 })
      .box(0.012, 0.03, 0.012, 0x8a8a8a, { y: 0.03 })
  },
  radio_board: (k) => {
    k.box(0.2, 0.01, 0.14, 0x2a6a3a)
      .box(0.08, 0.03, 0.06, 0xa0a4a8, { x: -0.04, y: 0.01 })
      .box(0.04, 0.012, 0.03, DARK, { x: 0.06, y: 0.01, z: 0.03 })
      .box(0.16, 0.005, 0.005, BRASS, { y: 0.01, z: -0.06 })
      .cyl(0.006, 0.02, 0x3a6ac0, { x: 0.06, y: 0.01, z: -0.03 })
  },
  fuse: (k) => {
    k.cyl(0.02, 0.1, 0xc8c8c8, {}, 'x')
      .cyl(0.021, 0.03, 0xc02a2a, {}, 'x')
      .cyl(0.022, 0.012, BRASS, { x: -0.056 }, 'x')
      .cyl(0.022, 0.012, BRASS, { x: 0.056 }, 'x')
  },
  keycard_blue: keycard(0x2a5ac8, 0x6a1a14),
  keycard_red: keycard(0xc82a2a, 0x1a1a1a),
  research: (k) => {
    k.box(0.23, 0.006, 0.31, 0x8a8070)
      .box(0.21, 0.025, 0.297, 0xe8e0c8, { y: 0.006, ry: 0.04 })
      .box(0.21, 0.004, 0.297, 0xf0ece0, { y: 0.031, ry: -0.06, x: 0.01 })
      .box(0.12, 0.002, 0.006, 0xb02a24, { y: 0.035, z: 0.02 })
  },
  sample: (k) => {
    k.box(0.24, 0.08, 0.16, 0x9aa0a8)
      .box(0.242, 0.012, 0.162, 0x3ad0d0, { y: 0.05 })
      .box(0.1, 0.014, 0.02, DARK, { y: 0.08 })
      .box(0.02, 0.02, 0.006, DARK, { x: -0.08, y: 0.04, z: 0.082 })
      .box(0.02, 0.02, 0.006, DARK, { x: 0.08, y: 0.04, z: 0.082 })
  },
  flare: (k) => {
    k.cyl(0.018, 0.22, 0xd82a24, {}, 'x')
      .cyl(0.019, 0.04, 0xf0e0a0, { x: 0.12 }, 'x')
      .cyl(0.019, 0.03, 0x2a2a2a, { x: -0.11 }, 'x')
  },
  teddy: (k) => {
    const c = 0x8a5a30
    const light = 0xb88a5a
    k.box(0.14, 0.15, 0.1, c, { y: 0.04 })
      .box(0.11, 0.1, 0.09, c, { y: 0.19 })
      .box(0.035, 0.035, 0.02, c, { x: -0.045, y: 0.27 })
      .box(0.035, 0.035, 0.02, c, { x: 0.045, y: 0.27 })
      .box(0.05, 0.035, 0.03, light, { y: 0.2, z: 0.05 })
      .box(0.015, 0.015, 0.01, DARK, { x: 0.025, y: 0.245, z: 0.045 })
      .box(0.012, 0.012, 0.01, DARK, { y: 0.225, z: 0.066 })
      .box(0.045, 0.045, 0.12, c, { x: -0.045, z: 0.06 })
      .box(0.045, 0.045, 0.12, c, { x: 0.045, z: 0.06 })
      .box(0.04, 0.11, 0.045, c, { x: -0.09, y: 0.07, rz: -0.3 })
      .box(0.04, 0.11, 0.045, c, { x: 0.09, y: 0.07, rz: 0.3 })
      .box(0.07, 0.07, 0.006, light, { y: 0.08, z: 0.05 })
  },
  photo: (k) => {
    k.box(0.15, 0.012, 0.2, 0x4a3020)
      .box(0.12, 0.002, 0.17, 0xe8e8e0, { y: 0.012 })
      .box(0.1, 0.002, 0.1, 0x5a6a8a, { y: 0.013, z: -0.02 })
      .box(0.1, 0.002, 0.03, 0x6a5a3a, { y: 0.0135, z: 0.025 })
  },
  dogtags: (k) => {
    k.box(0.03, 0.003, 0.05, 0xb8bcc2, { ry: 0.3 })
      .box(0.03, 0.003, 0.05, 0xd0d4d8, { x: 0.012, y: 0.003, z: 0.01, ry: -0.1 })
      .ring(0.05, 0.047, 0.003, 0x8a8e94, { z: -0.07 })
  },
  insulin: (k) => {
    k.cyl(0.009, 0.13, 0xe0f0f0, {}, 'x')
      .cyl(0.0095, 0.04, 0xe0a030, { x: 0.075 }, 'x')
      .box(0.006, 0.004, 0.004, DARK, { x: -0.04, y: 0.016 })
  },
  seeds: (k) => {
    for (const [i, ry] of [
      [0, -0.3],
      [1, 0],
      [2, 0.35],
    ] as const) {
      k.box(0.08, 0.004, 0.12, 0xc8a868, { x: (i - 1) * 0.03, y: i * 0.004, ry })
      k.box(0.06, 0.002, 0.04, [0xc83a2a, 0x5a9a3a, 0xe0a030][i] ?? 0x5a9a3a, {
        x: (i - 1) * 0.03,
        y: i * 0.004 + 0.004,
        ry,
      })
    }
  },
  toolbox: (k) => {
    k.box(0.48, 0.16, 0.22, 0x2a4ab0)
      .box(0.482, 0.04, 0.222, 0x22388a, { y: 0.16 })
      .box(0.482, 0.012, 0.222, 0x2a2a2a, { y: 0.13 })
      .box(0.2, 0.025, 0.025, 0x2a2a2a, { y: 0.22 })
      .box(0.02, 0.03, 0.025, 0x2a2a2a, { x: -0.09, y: 0.2 })
      .box(0.02, 0.03, 0.025, 0x2a2a2a, { x: 0.09, y: 0.2 })
  },
  map_piece: (k) => {
    k.box(0.12, 0.008, 0.2, 0xd8cca0)
      .box(0.002, 0.009, 0.2, 0xb0a480)
      .box(0.03, 0.001, 0.03, 0xc02a2a, { x: 0.02, y: 0.008, z: -0.04 })
      .box(0.02, 0.001, 0.02, 0xc02a2a, { x: -0.03, y: 0.008, z: 0.05 })
      .box(0.08, 0.001, 0.004, 0x3a6aa8, { y: 0.008, z: 0.01, ry: 0.5 })
  },
  cashbox: (k) => {
    k.box(0.3, 0.09, 0.22, 0x4a5a4a)
      .box(0.302, 0.03, 0.222, 0x3a483a, { y: 0.07 })
      .box(0.1, 0.014, 0.02, DARK, { y: 0.1 })
      .box(0.03, 0.03, 0.008, BRASS, { y: 0.045, z: 0.112 })
  },
  recipes: (k) => {
    k.box(0.18, 0.1, 0.1, 0xa83a2a)
      .box(0.186, 0.025, 0.106, 0xa83a2a, { y: 0.1 })
      .box(0.182, 0.03, 0.102, CREAM, { y: 0.04 })
  },
  vial: (k) => {
    k.cyl(0.012, 0.05, 0xe8e8e0)
      .cyl(0.0125, 0.02, 0xe8e8e0, { y: 0.015 })
      .cyl(0.013, 0.012, 0x8a8a8a, { y: 0.05 })
  },
  // Ammunition, coloured by calibre.
  ammo9: ammoBox(0.09, 0.05, 0.065, 0x3a5a9a, 0xe0e0e0),
  ammo45: ammoBox(0.1, 0.055, 0.07, 0x8a3a2a, 0xe0e0e0),
  ammo357: ammoBox(0.09, 0.05, 0.065, 0x2a2a2a, 0xc8a040),
  ammo22: ammoBox(0.07, 0.03, 0.05, 0xc8a040, 0xb82a24),
  ammo556: ammoBox(0.11, 0.07, 0.06, 0x4a6a3a, 0xe0e0e0),
  ammo762: ammoBox(0.12, 0.07, 0.065, 0x6a4a2a, 0xe0e0e0),
  ammo308: ammoBox(0.12, 0.08, 0.065, 0x3a3a6a, 0xe0e0e0),
  ammo12: (k) => {
    ammoBox(0.11, 0.065, 0.07, 0xc02a24, 0x2a2a2a)(k)
    k.cyl(0.0105, 0.07, 0xc02a24, { x: 0.02, z: 0.06 }, 'x').cyl(
      0.011,
      0.012,
      BRASS,
      { x: 0.06, z: 0.06 },
      'x',
    )
  },
  ammo50: (k) => {
    k.box(0.28, 0.17, 0.1, 0x4a5a3a)
      .box(0.284, 0.02, 0.104, 0x3a4a2e, { y: 0.17 })
      .box(0.12, 0.02, 0.02, DARK, { y: 0.19 })
      .box(0.08, 0.04, 0.002, 0xc8a040, { y: 0.07, z: 0.051 })
  },
  bolts: (k) => {
    for (const z of [-0.015, 0, 0.015]) {
      k.cyl(0.004, 0.36, 0x7a5a30, { z }, 'x')
        .box(0.03, 0.002, 0.012, 0xc83a2a, { x: -0.16, y: 0.004, z })
        .cyl(0.006, 0.025, 0x9aa0a8, { x: 0.19, y: -0.002, z }, 'x')
    }
  },
}

function keycard(color: number, lanyard: number): Build {
  return (k) => {
    k.box(0.054, 0.003, 0.086, color)
      .box(0.054, 0.0035, 0.018, 0xe0e0e0, { z: 0.02 })
      .box(0.02, 0.0035, 0.024, 0xd0d0d0, { z: -0.02 })
      .ring(0.06, 0.054, 0.002, lanyard, { z: -0.1 })
  }
}

/** Anything new without its own model: something plausible for its kind. */
const FALLBACK: Record<ItemKind, Build> = {
  weapon: (k) => k.box(0.3, 0.06, 0.08, GUNMETAL),
  ammo: ammoBox(0.09, 0.05, 0.065, 0x6a6a5a, 0xe0e0e0),
  food: can(0x8a7a5a, 0.038, 0.11),
  drink: bottle(0x8ac0e8, 0x5a5a5a),
  med: (k) => {
    k.box(0.12, 0.05, 0.08, WHITE).box(0.04, 0.002, 0.012, 0xc82a24, { y: 0.05 })
  },
  pack: backpack(0x6a6a5a, 0x2a2a2a, 0.3, 0.44, 0.18),
  wear: folded(0x6a5a8a),
  tool: carton(0.12, 0.06, 0.08, 0x7a7468, 0x4a4a4a),
  junk: carton(0.16, 0.08, 0.12, 0x7a7468, 0x5a5448),
  quest: carton(0.18, 0.1, 0.14, 0xc8a040, 0x8a6a28),
  money: (k) => {
    MODELS.cash?.(k)
  },
}

/** Whether an item has a model of its own (not just its kind's): for the tests. */
export function hasOwnModel(item: string): boolean {
  return item in MODELS || ITEMS[item]?.weapon !== undefined
}

const cache = new Map<string, ItemModel>()

/** The item's model, built once (unknown items: a plain parcel). */
export function itemModel(item: string): ItemModel {
  const hit = cache.get(item)
  if (hit) return hit
  const def = ITEMS[item]
  const k = new Kit()
  if (def?.weapon !== undefined) {
    // The gun as it lies on the floor: on its side (the real-size models from gun-models.ts).
    const gun = buildGunModel(def.weapon)
    gun.rotation.z = Math.PI / 2
    const holder = new THREE.Group()
    holder.add(gun)
    k.object(holder)
  } else {
    const build = MODELS[item] ?? FALLBACK[def?.kind ?? 'junk']
    build(k)
  }
  let model = k.build()
  // A gun that builds nothing (fists): a parcel rather than nothing at all.
  if (model.positions.length === 0) {
    const parcel = new Kit()
    FALLBACK.junk(parcel)
    model = parcel.build()
  }
  cache.set(item, model)
  return model
}

/** A standalone mesh of one item (previews, the item lineup). */
export function itemMesh(item: string): THREE.Mesh {
  const m = itemModel(item)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  return new THREE.Mesh(geo, ITEM_MATERIAL)
}

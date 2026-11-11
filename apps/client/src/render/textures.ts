import type { MaterialId } from '@office-fps/shared'
import * as THREE from 'three'

/** Texel density for world surfaces: 32 texels per metre. A texture covers `meters` × `meters`. */
export const TEXELS_PER_METER = 32

/** Deterministic PRNG so textures look identical on every client. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void

interface SurfaceStyle {
  /** World size covered by one texture repeat (m). */
  meters: number
  paint: Painter
  /** Per-texel brightness jitter applied after painting (0–1). */
  noise: number
  kind?: 'lit' | 'glass' | 'emissive'
  /** For emissive surfaces: HDR brightness (>1 glows through the bloom pass). */
  glow?: number
  /** Surfaces that shouldn't cast shadows (glass, thin glowing panels). */
  noShadow?: boolean
}

const fill =
  (color: string): Painter =>
  (ctx, size) => {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, size, size)
  }

/** Classic dev texture: flat color with a 1 m grid and half-metre ticks (gym). */
const dev =
  (base: string, line: string, hatch = false): Painter =>
  (ctx, size) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = line
    if (hatch) {
      for (let i = -size; i < size; i += 8) {
        for (let t = 0; t < 3; t++) for (let y = 0; y < size; y++) ctx.fillRect(i + y + t, y, 1, 1)
      }
    }
    ctx.fillRect(0, 0, size, 1)
    ctx.fillRect(0, 0, 1, size)
    ctx.fillRect(size / 2, 0, 1, 3)
    ctx.fillRect(0, size / 2, 3, 1)
  }

const STYLES: Record<MaterialId, SurfaceStyle> = {
  // ── Gym ──
  floor: { meters: 1, noise: 0.06, paint: dev('#6f7275', '#55585b') },
  wall: { meters: 1, noise: 0.04, paint: dev('#b9b6ad', '#9c998f') },
  cover: { meters: 1, noise: 0.05, paint: dev('#d0742f', '#a65a22') },
  platform: { meters: 1, noise: 0.05, paint: dev('#4f73a8', '#3b5a87') },
  marker: { meters: 1, noise: 0.05, paint: dev('#dcbc3c', '#ad922a') },
  target: { meters: 1, noise: 0.04, paint: dev('#b9362f', '#f1e6d2', true) },
  ramp: {
    meters: 1,
    noise: 0.05,
    paint: (ctx, size) => {
      // Green felt (gym ramps, ping-pong and pool tables) with a white edge line.
      ctx.fillStyle = '#2f7d4a'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#e8efe6'
      ctx.fillRect(0, 0, size, 1)
    },
  },

  // ── Office ──
  carpet: {
    meters: 1,
    noise: 0.1,
    paint: (ctx, size, rand) => {
      // 50 cm carpet tiles laid in alternating directions.
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          ctx.fillStyle = (tx + ty) % 2 ? '#4b5466' : '#465062'
          ctx.fillRect((tx * size) / 2, (ty * size) / 2, size / 2, size / 2)
        }
      }
      ctx.fillStyle = 'rgba(30,34,44,0.6)'
      for (let i = 0; i < 70; i++)
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      ctx.fillStyle = 'rgba(25,28,36,0.5)'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, size / 2, size, 1)
      ctx.fillRect(0, 0, 1, size)
      ctx.fillRect(size / 2, 0, 1, size)
    },
  },
  wood: {
    meters: 2,
    noise: 0.05,
    paint: (ctx, size, rand) => {
      // Oak planks: 8 rows (25 cm), staggered seams, darker grain streaks.
      const rows = 8
      const h = size / rows
      for (let r = 0; r < rows; r++) {
        const tone = 150 + Math.floor(rand() * 26)
        ctx.fillStyle = `rgb(${tone + 30},${tone - 8},${tone - 52})`
        ctx.fillRect(0, r * h, size, h)
        ctx.fillStyle = 'rgba(90,55,25,0.35)'
        for (let g = 0; g < 6; g++) {
          const y = r * h + 1 + Math.floor(rand() * (h - 2))
          const x = Math.floor(rand() * size)
          ctx.fillRect(x, y, 6 + Math.floor(rand() * 18), 1)
        }
        ctx.fillStyle = 'rgba(60,35,15,0.7)'
        ctx.fillRect(0, r * h, size, 1)
        const seam = Math.floor(((r * 0.37) % 1) * size)
        ctx.fillRect(seam, r * h, 1, h)
      }
    },
  },
  tile: {
    meters: 1,
    noise: 0.04,
    paint: (ctx, size) => {
      ctx.fillStyle = '#d9d6cf'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#aaa59b'
      for (let i = 0; i < size; i += size / 2) {
        ctx.fillRect(i, 0, 1, size)
        ctx.fillRect(0, i, size, 1)
      }
    },
  },
  concrete: {
    meters: 2,
    noise: 0.07,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#a2a19c'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rand() < 0.5 ? 'rgba(120,118,112,0.35)' : 'rgba(190,188,182,0.35)'
        const s = 2 + Math.floor(rand() * 8)
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), s, s)
      }
      ctx.fillStyle = 'rgba(80,78,74,0.35)'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
    },
  },
  plaster: { meters: 1, noise: 0.03, paint: fill('#e7e4de') },
  ceiling: {
    meters: 1.2,
    noise: 0.03,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#eceae6'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(160,158,150,0.6)'
      for (let i = 0; i < 60; i++)
        ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1, 1)
      ctx.fillStyle = '#c3c1bb'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
      ctx.fillRect(0, size / 2, size, 1)
      ctx.fillRect(size / 2, 0, 1, size)
    },
  },
  glass: {
    meters: 1,
    noise: 0,
    kind: 'glass',
    noShadow: true,
    paint: (ctx, size) => {
      ctx.fillStyle = '#bfe0f5'
      ctx.fillRect(0, 0, size, size)
      // A couple of diagonal reflection streaks.
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      for (let i = 0; i < size; i++) {
        ctx.fillRect((i + 6) % size, i, 2, 1)
        ctx.fillRect((i + 14) % size, i, 1, 1)
      }
    },
  },
  desk: {
    meters: 1,
    noise: 0.03,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#e4dccd'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(170,150,120,0.35)'
      for (let i = 0; i < 18; i++) ctx.fillRect(0, Math.floor(rand() * size), size, 1)
    },
  },
  metal: {
    meters: 1,
    noise: 0.04,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#3c4048'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(120,126,136,0.35)'
      for (let i = 0; i < 24; i++) ctx.fillRect(0, Math.floor(rand() * size), size, 1)
    },
  },
  fabric: {
    meters: 0.5,
    noise: 0.08,
    paint: (ctx, size) => {
      ctx.fillStyle = '#2f7d86'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(15,60,66,0.5)'
      for (let i = 0; i < size; i += 2) ctx.fillRect(i, 0, 1, size)
    },
  },
  fabricAlt: {
    meters: 0.5,
    noise: 0.08,
    paint: (ctx, size) => {
      ctx.fillStyle = '#3b3e49'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = 'rgba(20,22,30,0.5)'
      for (let i = 0; i < size; i += 2) ctx.fillRect(0, i, size, 1)
    },
  },
  screen: {
    meters: 0.5,
    noise: 0,
    kind: 'emissive',
    glow: 1.3,
    paint: (ctx, size, rand) => {
      // Dark editor with coloured "code" lines.
      ctx.fillStyle = '#101624'
      ctx.fillRect(0, 0, size, size)
      const colors = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#c0caf5']
      for (let y = 2; y < size - 1; y += 2) {
        let x = 1 + Math.floor(rand() * 4)
        while (x < size - 2 && rand() < 0.8) {
          const w = 2 + Math.floor(rand() * 6)
          ctx.fillStyle = colors[Math.floor(rand() * colors.length)] ?? '#fff'
          ctx.fillRect(x, y, Math.min(w, size - 1 - x), 1)
          x += w + 1
        }
      }
    },
  },
  plant: {
    meters: 0.5,
    noise: 0.12,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#24562c'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle =
          ['#3d8a45', '#2f7239', '#58a85a', '#1d4523'][Math.floor(rand() * 4)] ?? '#3d8a45'
        const x = Math.floor(rand() * size)
        const y = Math.floor(rand() * size)
        ctx.fillRect(x, y, 2 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 3))
      }
    },
  },
  accent: { meters: 1, noise: 0.04, paint: fill('#b33831') },
  lightpanel: {
    meters: 0.6,
    noise: 0,
    kind: 'emissive',
    glow: 3,
    noShadow: true,
    paint: (ctx, size) => {
      ctx.fillStyle = '#fffaf0'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#d8d3c8'
      ctx.fillRect(0, 0, size, 1)
      ctx.fillRect(0, 0, 1, size)
    },
  },
  rack: {
    meters: 1,
    noise: 0.03,
    kind: 'emissive',
    glow: 1,
    paint: (ctx, size, rand) => {
      // Black rack units with blinking-light rows.
      ctx.fillStyle = '#121418'
      ctx.fillRect(0, 0, size, size)
      for (let y = 0; y < size; y += 4) {
        ctx.fillStyle = '#23262d'
        ctx.fillRect(0, y, size, 1)
        for (let x = 2; x < size; x += 3) {
          if (rand() < 0.35) {
            ctx.fillStyle = rand() < 0.7 ? '#39ff8a' : '#4aa8ff'
            ctx.fillRect(x, y + 2, 1, 1)
          }
        }
      }
    },
  },
  whiteboard: {
    meters: 1,
    noise: 0.02,
    paint: (ctx, size, rand) => {
      ctx.fillStyle = '#f4f4f1'
      ctx.fillRect(0, 0, size, size)
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = rand() < 0.5 ? '#2b6cb0' : '#c53030'
        const y = 4 + Math.floor(rand() * (size - 8))
        ctx.fillRect(3, y, 6 + Math.floor(rand() * 18), 1)
      }
    },
  },
}

function makeTexture(style: SurfaceStyle, seed: number): THREE.CanvasTexture {
  const size = Math.max(8, Math.round(style.meters * TEXELS_PER_METER))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const rand = mulberry32(seed)
  style.paint(ctx, size, rand)

  if (style.noise > 0) {
    const img = ctx.getImageData(0, 0, size, size)
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 + (rand() * 2 - 1) * style.noise
      img.data[i] = Math.min(255, (img.data[i] ?? 0) * k)
      img.data[i + 1] = Math.min(255, (img.data[i + 1] ?? 0) * k)
      img.data[i + 2] = Math.min(255, (img.data[i + 2] ?? 0) * k)
    }
    ctx.putImageData(img, 0, 0)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  // Nearest mip selection keeps the crisp look while killing distance shimmer.
  texture.minFilter = THREE.NearestMipmapNearestFilter
  texture.generateMipmaps = true
  // World UVs are in metres; scale so one repeat covers `meters`.
  texture.repeat.set(1 / style.meters, 1 / style.meters)
  return texture
}

const cache = new Map<MaterialId, THREE.Material>()

/** Whether boxes of this material should cast shadows. */
export function castsShadow(id: MaterialId): boolean {
  return !STYLES[id].noShadow
}

export function isTransparent(id: MaterialId): boolean {
  return STYLES[id].kind === 'glass'
}

export function getSurfaceMaterial(id: MaterialId): THREE.Material {
  let material = cache.get(id)
  if (material) return material
  const style = STYLES[id]
  const seed = [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
  const map = makeTexture(style, seed)
  if (style.kind === 'glass') {
    material = new THREE.MeshPhongMaterial({
      map,
      transparent: true,
      opacity: 0.28,
      shininess: 90,
      specular: 0x99aabb,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  } else if (style.kind === 'emissive') {
    material = new THREE.MeshLambertMaterial({
      map,
      emissiveMap: map,
      emissive: 0xffffff,
      emissiveIntensity: style.glow ?? 1,
    })
  } else {
    material = new THREE.MeshLambertMaterial({ map })
  }
  cache.set(id, material)
  return material
}

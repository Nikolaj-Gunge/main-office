import type { MaterialId } from '@office-fps/shared'
import * as THREE from 'three'

/** Texel density for world surfaces: one texture repeat = 1 m. */
export const TEXELS_PER_METER = 32

interface DevTextureStyle {
  base: string
  line: string
  /** Max per-texel brightness jitter (0–1). */
  noise: number
  /** Draw a diagonal hatch, used to make hazards/targets pop. */
  hatch?: boolean
}

// Classic "dev texture" look: flat color, 1 m grid lines, light noise. Readable metrics everywhere.
const STYLES: Record<MaterialId, DevTextureStyle> = {
  floor: { base: '#6f7275', line: '#55585b', noise: 0.06 },
  wall: { base: '#b9b6ad', line: '#9c998f', noise: 0.04 },
  cover: { base: '#d0742f', line: '#a65a22', noise: 0.05 },
  platform: { base: '#4f73a8', line: '#3b5a87', noise: 0.05 },
  marker: { base: '#dcbc3c', line: '#ad922a', noise: 0.05 },
  target: { base: '#b9362f', line: '#f1e6d2', noise: 0.04, hatch: true },
  ramp: { base: '#5d9a4a', line: '#477a38', noise: 0.05 },
}

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

function makeDevTexture(style: DevTextureStyle, seed: number): THREE.CanvasTexture {
  const size = TEXELS_PER_METER
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')

  ctx.fillStyle = style.base
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = style.line
  if (style.hatch) {
    for (let i = -size; i < size; i += 8) {
      for (let t = 0; t < 3; t++) {
        for (let y = 0; y < size; y++) ctx.fillRect(i + y + t, y, 1, 1)
      }
    }
  }
  // Grid lines on two edges: tiles join into a continuous 1 m grid.
  ctx.fillRect(0, 0, size, 1)
  ctx.fillRect(0, 0, 1, size)
  // Half-meter tick marks.
  ctx.fillRect(size / 2, 0, 1, 3)
  ctx.fillRect(0, size / 2, 3, 1)

  const rand = mulberry32(seed)
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 1 + (rand() * 2 - 1) * style.noise
    img.data[i] = Math.min(255, (img.data[i] ?? 0) * k)
    img.data[i + 1] = Math.min(255, (img.data[i + 1] ?? 0) * k)
    img.data[i + 2] = Math.min(255, (img.data[i + 2] ?? 0) * k)
  }
  ctx.putImageData(img, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  // Nearest mip selection keeps the crisp look while killing distance shimmer.
  texture.minFilter = THREE.NearestMipmapNearestFilter
  texture.generateMipmaps = true
  return texture
}

const cache = new Map<MaterialId, THREE.MeshLambertMaterial>()

export function getSurfaceMaterial(id: MaterialId): THREE.MeshLambertMaterial {
  let material = cache.get(id)
  if (!material) {
    const seed = [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
    material = new THREE.MeshLambertMaterial({ map: makeDevTexture(STYLES[id], seed) })
    cache.set(id, material)
  }
  return material
}

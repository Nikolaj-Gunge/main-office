import { hash2 } from '@office-fps/shared'
import * as THREE from 'three'
import { filterTexture } from './textures.ts'

/**
 * Surface grain for the forest (wilds.ts, forest-lod.ts): bark streaks, clumpy leaves, speckled
 * rock — painted into one small tiling texture and laid over the vertex colours in world space,
 * so the trees keep their shapes and need no UVs. Each face picks the texture up flat on its
 * own plane (sides by their facing, tops from above), in whole texels like the rest of the
 * world, and blends them when the player turns on smooth textures. Which channel a face shows
 * goes by its vertex colour: green is foliage, blue-grey is rock, the rest wood (pale wood is
 * birch). Far away the mips even it out to the plain colour.
 */

/** Texels a metre. */
export const GRAIN_PX = 12
/** The texture is GRAIN_SIZE² texels and repeats (every GRAIN_SIZE / GRAIN_PX metres). */
export const GRAIN_SIZE = 128
/** A channel's 0…1 turns the colour into LOW … LOW + RANGE times itself (0.5: unchanged). */
export const GRAIN_LOW = 0.5
export const GRAIN_RANGE = 1
/** Linear red above which wood is birch bark (white with dark marks). */
export const GRAIN_PALE = 0.25

const N = GRAIN_SIZE

/** Value noise that wraps round the texture: lattice every `cell` texels. */
function tileNoise(x: number, y: number, cell: number, seed: number): number {
  const period = N / cell
  const gx = x / cell
  const gy = y / cell
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const h = (i: number, j: number) => hash2(i % period, j % period, seed)
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx
  return a + (b - a) * sy
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** The four channels, 0…255: R bark, G foliage, B rock, A birch (row 0 at the bottom). */
function paintGrain(): Uint8Array {
  const data = new Uint8Array(N * N * 4)
  const bark = new Float32Array(N * N)
  const leaf = new Float32Array(N * N)
  const rock = new Float32Array(N * N)
  const birch = new Float32Array(N * N)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      // Bark: ridges, every column of texels its own shade, with dark grooves between that
      // run a way up the trunk and break off.
      const column = hash2(x, 0, 51)
      const drift = tileNoise(x, y, 16, 52)
      const groove = column < 0.3 && tileNoise(x, y, 6, 50) > 0.35
      bark[i] = groove ? 0.2 : 0.36 + (column - 0.3) * 0.45 + drift * 0.15
      // Leaves: dark hollows and lit clumps half a metre across, tufts of 2×2 texels on top.
      const clumps = tileNoise(x, y, 8, 53)
      const tufts = hash2(x >> 1, y >> 1, 54)
      leaf[i] = 0.2 + clumps * 0.4 + tufts * 0.25
      // Rock: grit and broad stains.
      rock[i] = 0.25 + hash2(x, y, 55) * 0.35 + tileNoise(x, y, 32, 56) * 0.25
      birch[i] = 0.5 + (hash2(x, y, 57) - 0.5) * 0.12
    }
  }
  // Bark: deep splits running up the trunk, a texel wide, some way between branches.
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(hash2(k, 1, 58) * N)
    const y0 = Math.floor(hash2(k, 2, 58) * N)
    const len = 6 + Math.floor(hash2(k, 3, 58) * 18)
    for (let j = 0; j < len; j++) bark[((y0 + j) % N) * N + x] = 0.05
  }
  // Rock: cracks wandering across, a texel at a time.
  for (let k = 0; k < 16; k++) {
    let x = Math.floor(hash2(k, 4, 59) * N)
    let y = Math.floor(hash2(k, 5, 59) * N)
    const dx = hash2(k, 6, 59) < 0.5 ? 1 : -1
    for (let j = 0; j < 14 + hash2(k, 7, 59) * 16; j++) {
      rock[((y + N) % N) * N + ((x + N) % N)] = 0.05
      if (hash2(k, j, 60) < 0.6) x += dx
      else y += hash2(k, j, 61) < 0.5 ? 1 : -1
    }
  }
  // Birch: the black dashes across a white trunk.
  for (let k = 0; k < 400; k++) {
    const x0 = Math.floor(hash2(k, 8, 62) * N)
    const y = Math.floor(hash2(k, 9, 62) * N)
    const len = 2 + Math.floor(hash2(k, 10, 62) * 5)
    for (let j = 0; j < len; j++) birch[y * N + ((x0 + j) % N)] = 0.05
  }
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(clamp01(bark[i] as number) * 255)
    data[i * 4 + 1] = Math.round(clamp01(leaf[i] as number) * 255)
    data[i * 4 + 2] = Math.round(clamp01(rock[i] as number) * 255)
    data[i * 4 + 3] = Math.round(clamp01(birch[i] as number) * 255)
  }
  return data
}

let grainData: Uint8Array | null = null
let grainTexture: THREE.DataTexture | null = null

function grainPixels(): Uint8Array {
  grainData ??= paintGrain()
  return grainData
}

/** The grain texture, made once (crisp or smooth with the world's other textures). */
export function grainMap(): THREE.DataTexture {
  if (grainTexture) return grainTexture
  const texture = new THREE.DataTexture(grainPixels(), N, N, THREE.RGBAFormat)
  // Data, not colour: the channels are read as is.
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = true
  filterTexture(texture)
  grainTexture = texture
  return texture
}

/**
 * How much grain darkens or lightens a texel of colour (r, g, b, linear 0…1) at texel (x, y) of
 * the grain (the card atlas uses it to paint the same grain on the far trees as the shader does).
 */
export function grainFactor(r: number, g: number, b: number, x: number, y: number): number {
  const data = grainPixels()
  const i = ((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4
  let channel: number
  if (g >= Math.max(r * 1.05, b)) channel = 1
  else if (b >= r) channel = 2
  else channel = r >= GRAIN_PALE ? 3 : 0
  return GRAIN_LOW + ((data[i + channel] as number) / 255) * GRAIN_RANGE
}

/** GLSL: picks the texture up on the face's plane and scales `diffuseColor` by it. */
const GRAIN_FRAGMENT = /* glsl */ `
  vec3 grainN = normalize(vGrainNormal);
  vec2 grainSide = vec2(-grainN.z, grainN.x);
  grainSide /= max(length(grainSide), 1e-4);
  vec2 grainAt = abs(grainN.y) > 0.7 ? vGrainPos.xz : vec2(dot(vGrainPos.xz, grainSide), vGrainPos.y);
  vec4 grainTexel = texture2D(grainMap, grainAt * ${(GRAIN_PX / GRAIN_SIZE).toFixed(6)});
  float grainLeafy = step(max(vColor.r * 1.05, vColor.b), vColor.g);
  float grainStone = (1.0 - grainLeafy) * step(vColor.r, vColor.b);
  float grainWood = mix(grainTexel.r, grainTexel.a, step(${GRAIN_PALE.toFixed(2)}, vColor.r));
  float grain = mix(mix(grainWood, grainTexel.b, grainStone), grainTexel.g, grainLeafy);
  diffuseColor.rgb *= ${GRAIN_LOW.toFixed(2)} + grain * ${GRAIN_RANGE.toFixed(2)};
`

/**
 * Patch a vertex-coloured material (built in world coordinates) with the grain. Keeps any patch
 * it already has: the cache key becomes "<old key> grain" (the WebGPU twins go by its words).
 */
export function makeGrained(material: THREE.Material): void {
  const before =
    material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile
      ? null
      : material.onBeforeCompile
  const key = before ? `${material.customProgramCacheKey()} grain` : 'grain'
  const map = grainMap()
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer)
    shader.uniforms.grainMap = { value: map }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vGrainPos;\nvarying vec3 vGrainNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGrainPos = position;\nvGrainNormal = normal;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D grainMap;\nvarying vec3 vGrainPos;\nvarying vec3 vGrainNormal;',
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GRAIN_FRAGMENT}`)
  }
  material.customProgramCacheKey = () => key
}

import type { MapBox } from '@office-fps/shared'
import * as THREE from 'three'
import { TEXELS_PER_METER } from './textures.ts'

/**
 * Corn: boxes of material 'corn' are drawn as a field of stalks (two crossed, alpha-cut quads
 * each, one instanced mesh) instead of solid boxes. The stalks sway in the wind and bend away
 * from whoever pushes through them — so you see the corn move where the zombies are coming.
 */

/** Distance between stalks (m), on one lattice over the whole map so neighbouring boxes join up. */
const SPACING = 0.42
/** Stalk height (m) before per-stalk scale. */
const HEIGHT = 2.6
const WIDTH = 0.95
/** People pushing corn: at most this many, the nearest to the camera. */
const MAX_PUSHERS = 24
/** How far (m) round a pusher the corn bends. */
const PUSH_RADIUS = 1.5

const uniforms = {
  uTime: { value: 0 },
  uPushers: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector3()) },
}

/** Deterministic hash → 0…1, so every client grows the same field. */
function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 100) ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ Math.round(z * 100) ^ (salt * 0x27d4eb2d), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function stalkTexture(): THREE.CanvasTexture {
  const w = Math.round(WIDTH * TEXELS_PER_METER)
  const h = Math.round(HEIGHT * TEXELS_PER_METER)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const mid = Math.floor(w / 2)
  const leaf = ['#4f6e2c', '#5f7d33', '#3f5a24', '#748a3a', '#8c8f45']
  // Stalk.
  ctx.fillStyle = '#5b7432'
  ctx.fillRect(mid - 1, 6, 2, h - 6)
  // Leaves: long blades that climb out from the stalk and droop at the tips.
  for (let i = 0; i < 14; i++) {
    const y0 = 14 + Math.floor(rand() * (h - 26))
    const dir = i % 2 === 0 ? 1 : -1
    const len = 8 + Math.floor(rand() * (mid - 3))
    ctx.fillStyle = leaf[Math.floor(rand() * leaf.length)] ?? '#4f6e2c'
    for (let s = 0; s < len; s++) {
      const t = s / len
      const x = mid + dir * (s + 1)
      const y = Math.round(y0 - 6 * t + 14 * t * t)
      const thick = t < 0.7 ? 2 : 1
      ctx.fillRect(x, y, 1, thick)
    }
  }
  // Ears: a cob in its husk, one or two per stalk.
  for (const [y, dir] of [
    [Math.floor(h * 0.45), 1],
    [Math.floor(h * 0.58), -1],
  ] as const) {
    const x = mid + (dir > 0 ? 1 : -4)
    ctx.fillStyle = '#7a8a3a'
    ctx.fillRect(x, y, 3, 9)
    ctx.fillStyle = '#c9b25a'
    ctx.fillRect(x + 1, y + 1, 1, 6)
    ctx.fillStyle = '#9a6b3a'
    ctx.fillRect(x + 1, y - 2, 1, 2) // silk
  }
  // Tassel.
  ctx.fillStyle = '#b39a58'
  for (let i = -3; i <= 3; i++) {
    ctx.fillRect(mid + i, 2 + Math.abs(i), 1, 5)
  }
  ctx.fillRect(mid, 0, 1, 7)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapNearestFilter
  return texture
}

/** Two crossed quads, bottom centre at the origin. */
function stalkGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(WIDTH, HEIGHT)
  a.translate(0, HEIGHT / 2, 0)
  const b = a.clone()
  b.rotateY(Math.PI / 2)
  const merged = new THREE.BufferGeometry()
  const pos: number[] = []
  const uv: number[] = []
  const normal: number[] = []
  const index: number[] = []
  for (const g of [a, b]) {
    const base = pos.length / 3
    pos.push(...g.getAttribute('position').array)
    uv.push(...g.getAttribute('uv').array)
    normal.push(...g.getAttribute('normal').array)
    for (const i of g.index?.array ?? []) index.push(base + i)
    g.dispose()
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  merged.setIndex(index)
  return merged
}

function cornMaterial(): THREE.Material {
  const material = new THREE.MeshLambertMaterial({
    map: stalkTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uPushers = uniforms.uPushers
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec3 uPushers[${MAX_PUSHERS}];`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = instanceMatrix * vec4( transformed, 1.0 );
{
  vec3 root = instanceMatrix[3].xyz;
  float bend = clamp( position.y / ${HEIGHT.toFixed(2)}, 0.0, 1.0 );
  bend *= bend;
  vec2 sway = vec2(
    sin( uTime * 1.1 + root.x * 0.31 + root.z * 0.17 ) * 0.07 + sin( uTime * 2.9 + root.z * 0.8 ) * 0.02,
    sin( uTime * 0.9 + root.z * 0.27 ) * 0.05
  );
  for ( int i = 0; i < ${MAX_PUSHERS}; i++ ) {
    vec3 p = uPushers[ i ];
    if ( p.z <= 0.0 ) continue;
    vec2 away = root.xz - p.xy;
    float d = length( away );
    float k = p.z * max( 0.0, 1.0 - d / ${PUSH_RADIUS.toFixed(2)} );
    if ( k <= 0.0 ) continue;
    away = d > 0.01 ? away / d : vec2( 1.0, 0.0 );
    // Bent aside, plus a shiver: corn being shoved through rustles.
    sway += away * k * 0.55 + vec2( sin( uTime * 17.0 + root.x * 5.0 ), cos( uTime * 15.0 + root.z * 5.0 ) ) * k * 0.08;
  }
  mvPosition.xz += sway * bend;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      )
  }
  material.customProgramCacheKey = () => 'corn'
  return material
}

/** The corn for a map's corn boxes (null if it has none). */
export function buildCorn(boxes: MapBox[]): THREE.InstancedMesh | null {
  if (boxes.length === 0) return null
  const spots: { x: number; y: number; z: number; box: MapBox }[] = []
  const inset = 0.12
  for (const box of boxes) {
    const [cx, cy, cz] = box.center
    const [sx, sy, sz] = box.size
    const x0 = cx - sx / 2 + inset
    const x1 = cx + sx / 2 - inset
    const z0 = cz - sz / 2 + inset
    const z1 = cz + sz / 2 - inset
    // Lattice points whose cell centre falls in this box: shared edges never get two stalks.
    for (let gx = Math.ceil((cx - sx / 2) / SPACING); gx * SPACING < cx + sx / 2; gx++) {
      for (let gz = Math.ceil((cz - sz / 2) / SPACING); gz * SPACING < cz + sz / 2; gz++) {
        const x = gx * SPACING + (hash(gx, gz, 1) - 0.5) * SPACING * 0.8
        const z = gz * SPACING + (hash(gx, gz, 2) - 0.5) * SPACING * 0.8
        spots.push({
          x: Math.min(x1, Math.max(x0, x)),
          y: cy - sy / 2,
          z: Math.min(z1, Math.max(z0, z)),
          box,
        })
      }
    }
  }
  const mesh = new THREE.InstancedMesh(stalkGeometry(), cornMaterial(), spots.length)
  mesh.name = 'corn'
  const matrix = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const scale = new THREE.Vector3()
  const pos = new THREE.Vector3()
  const color = new THREE.Color()
  spots.forEach((s, i) => {
    const r = hash(s.x, s.z, 3)
    q.setFromAxisAngle(up, r * Math.PI)
    const height = Math.min(1.15, (s.box.size[1] / HEIGHT) * (0.88 + hash(s.x, s.z, 4) * 0.22))
    const width = 0.85 + hash(s.x, s.z, 5) * 0.35
    scale.set(width, height, width)
    pos.set(s.x, s.y, s.z)
    matrix.compose(pos, q, scale)
    mesh.setMatrixAt(i, matrix)
    // Some stalks greener, some drier.
    const dry = hash(s.x, s.z, 6)
    color.setRGB(0.85 + dry * 0.25, 0.9 + dry * 0.1, 0.75 - dry * 0.15)
    mesh.setColorAt(i, color)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  // The field never moves (only the shader sways it): bounds once, no per-stalk culling.
  mesh.computeBoundingSphere()
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Per frame: the wind clock and who is pushing through the corn (feet x/z). The nearest to
 * `eye` win when there are more than the shader takes.
 */
export function updateCorn(
  seconds: number,
  people: Iterable<{ x: number; z: number }>,
  eye: { x: number; z: number },
): void {
  uniforms.uTime.value = seconds
  const near = [...people]
    .map((p) => ({ p, d: (p.x - eye.x) ** 2 + (p.z - eye.z) ** 2 }))
    .sort((a, b) => a.d - b.d)
  const slots = uniforms.uPushers.value
  for (let i = 0; i < MAX_PUSHERS; i++) {
    const n = near[i]
    if (n) slots[i]?.set(n.p.x, n.p.z, 1)
    else slots[i]?.set(0, 0, 0)
  }
}

// For the WebGPU renderer's TSL twin of the corn shader (corn.tsl.ts).
export {
  HEIGHT as CORN_HEIGHT,
  MAX_PUSHERS as CORN_MAX_PUSHERS,
  PUSH_RADIUS as CORN_PUSH_RADIUS,
  uniforms as cornUniforms,
}

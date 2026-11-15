import * as THREE from 'three'

/**
 * Cascaded shadows for survival's moon and sun: instead of one shadow map around you, up to three
 * nested squares — a small, sharp one at your feet and wider, coarser ones out to forest scale.
 * Every cascade is its own shadow-casting DirectionalLight with the same colour and direction; the
 * patched light loop (shadow-fade.ts) lights the world from the first only, taking its shadow
 * from the smallest cascade that covers the pixel. Same hard-edged PCF as before: just more of it.
 */

/** Cascades the WebGL path can draw (the shader is written for at most this many). */
export const MAX_CASCADES = 3

let rendererAllows = true
let shaderAllows = false

/** Whether the renderer can do cascades (only the WebGL path is patched; WebGPU keeps one). */
export function allowCascades(ok: boolean): void {
  rendererAllows = ok
}

/** Set by shadow-fade.ts once its shader patch (with the cascade picker) is in. */
export function cascadeShaderInstalled(ok: boolean): void {
  shaderAllows = ok
}

/**
 * The cascades (reach per cascade, m, nearest first) to draw: the tier's, or a single one of
 * `fallback` m where cascades can't be drawn.
 */
export function cascadeReaches(tier: readonly number[], fallback: number): number[] {
  if (!rendererAllows || !shaderAllows || tier.length <= 1) return [tier[0] ?? fallback]
  return tier.slice(0, MAX_CASCADES)
}

/**
 * How far (m) you walk before a cascade is redrawn: a quarter of its reach, so the near one keeps
 * up with you (it's small, so cheap) and the far one is hardly ever drawn. One cascade stays at
 * the 20 m it always was.
 */
export function cascadeStep(reach: number, count: number): number {
  return count <= 1 ? 20 : Math.max(5, reach / 4)
}

const right = new THREE.Vector3()
const up = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

/**
 * `at` moved onto the shadow map's texel grid (`texel` m) across the light, so a redrawn map's
 * texels land where the last one's did: edges don't crawl when the map follows you.
 */
export function snapToTexel(
  at: THREE.Vector3,
  lightDir: THREE.Vector3,
  texel: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  right.crossVectors(Math.abs(lightDir.y) > 0.99 ? Z : Y, lightDir).normalize()
  up.crossVectors(lightDir, right).normalize()
  const r = at.dot(right)
  const u = at.dot(up)
  const d = at.dot(lightDir)
  const snap = (v: number) => Math.round(v / texel) * texel
  return out
    .copy(right)
    .multiplyScalar(snap(r))
    .addScaledVector(up, snap(u))
    .addScaledVector(lightDir, d)
}

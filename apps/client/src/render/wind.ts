import type { MapLight } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * One wind for the whole world, so the trees, the hanging lamps and the falling leaves all move
 * together: a steady breeze from the north-west with gusts rolling through every few seconds.
 * Visual only — nothing here touches the simulation.
 */
export const wind = {
  /** Seconds, the clock everything sways to. */
  time: 0,
  /** 0 in a lull … 1 at the peak of a gust. */
  gust: 0,
  /** Which way it blows (unit vector on the ground plane). */
  dir: new THREE.Vector2(0.8, 0.6).normalize(),
}

/** Gust strength at time t: slow swells with a quicker flutter on top, 0–1. */
export function gustAt(t: number): number {
  const swell = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.7)
  const flutter = 0.5 + 0.5 * Math.sin(t * 1.3 + Math.sin(t * 0.7) * 2)
  return Math.min(1, swell * 0.8 + flutter * swell * 0.35)
}

/** Advance the wind to now (call once a frame). */
export function tickWind(seconds: number): void {
  wind.time = seconds
  wind.gust = gustAt(seconds)
}

/**
 * How far a lamp on a cord of length `hang` has swung at time t (radians about x and z).
 * A pendulum's own beat (√(g/L)) with a little drift; outdoors the wind pushes it about.
 */
export function lampSwing(
  index: number,
  hang: number,
  t: number,
  outdoors: boolean,
  out: THREE.Euler,
): THREE.Euler {
  const beat = Math.sqrt(9.81 / Math.max(0.2, hang))
  const phase = index * 1.93
  const push = outdoors ? 0.05 + 0.22 * gustAt(t - index * 0.05) : 0.035
  const ax = push * Math.sin(beat * t + phase) + (outdoors ? wind.dir.y * push * 0.6 : 0)
  const az =
    push * 0.6 * Math.sin(beat * 1.07 * t + phase * 1.3) - (outdoors ? wind.dir.x * push * 0.6 : 0)
  return out.set(ax, 0, az)
}

const euler = new THREE.Euler()
const offset = new THREE.Vector3()

/** Where a hanging light is right now: swung about the point `hang` metres above it. */
export function hangingLightPos(
  light: MapLight,
  index: number,
  t: number,
  outdoors: boolean,
  out: THREE.Vector3,
): THREE.Vector3 {
  const [x, y, z] = light.pos
  if (!light.hang) return out.set(x, y, z)
  lampSwing(index, light.hang, t, outdoors, euler)
  offset.set(0, -light.hang, 0).applyEuler(euler)
  return out.set(x, y + light.hang, z).add(offset)
}

/**
 * GLSL for swaying vertices: `sway.x` is how much a vertex bends (0 at the roots), `sway.y` its
 * own phase. Moves `transformed` (world space, the forest is built in world coordinates).
 */
export const SWAY_VERTEX = /* glsl */ `
  float bend = sway.x * (0.35 + uWindGust * 1.1);
  float wave = sin(uWindTime * 1.7 + sway.y) * 0.6 + sin(uWindTime * 2.9 + sway.y * 1.7) * 0.25;
  float lean = (0.25 + uWindGust * 0.9) * sway.x;
  transformed.xz += uWindDir * (wave * bend + lean) * 0.35;
  transformed.xz += vec2(-uWindDir.y, uWindDir.x) * sin(uWindTime * 2.3 + sway.y * 2.1) * bend * 0.12;
`

/** Uniforms the swaying shader reads; shared, so one update moves every forest chunk. */
export const windUniforms = {
  uWindTime: { value: 0 },
  uWindGust: { value: 0 },
  uWindDir: { value: wind.dir },
}

/** Copies the wind into the shader uniforms. */
export function syncWindUniforms(): void {
  windUniforms.uWindTime.value = wind.time
  windUniforms.uWindGust.value = wind.gust
}

/** Patch a material so geometry with a `sway` attribute bends in the wind. */
export function makeSwaying(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 sway;\nuniform float uWindTime;\nuniform float uWindGust;\nuniform vec2 uWindDir;',
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_VERTEX}`)
  }
  material.customProgramCacheKey = () => 'swaying'
}

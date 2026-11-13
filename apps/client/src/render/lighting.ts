import type { MapDef, MapLight, MapLighting } from '@office-fps/shared'
import * as THREE from 'three'
import { hangingLightPos, wind } from './wind.ts'

/** A map without much sun is a night map: it gets the dark treatment. */
export const isNight = (l: MapLighting): boolean => l.sunIntensity < 1

const scratch = new THREE.Color()
/** `color` with its saturation and brightness scaled. */
function tuned(color: number, saturation: number, brightness: number): number {
  const hsl = scratch.setHex(color).getHSL({ h: 0, s: 0, l: 0 })
  return scratch
    .setHSL(hsl.h, Math.min(1, hsl.s * saturation), Math.min(1, hsl.l * brightness))
    .getHex()
}

/**
 * The look on top of what a map asks for: far less fill light, so what the sun and the lamps
 * don't reach goes properly dark, and a stronger, warmer sun to make up for it. Night maps lose
 * most of their fill and their fog closes in and darkens: you see as far as the lamps reach.
 */
export function gradeLighting(l: MapLighting): MapLighting {
  const night = isNight(l)
  return {
    ...l,
    sunColor: tuned(l.sunColor, 1.35, 1),
    sunIntensity: l.sunIntensity * (night ? 0.8 : 1.25),
    ambientIntensity: l.ambientIntensity * (night ? 0.4 : 0.6),
    skyColor: night ? tuned(l.skyColor, 1.2, 0.6) : l.skyColor,
    fogColor: night ? tuned(l.fogColor, 1.2, 0.45) : l.fogColor,
    fogNear: l.fogNear * (night ? 0.6 : 1),
    fogFar: l.fogFar * (night ? 0.75 : 1),
  }
}

/** Point lamps lit at once (the nearest to the camera); the rest of a map's lamps wait. */
const POINT_POOL = 12

/** Lamps: brighter and more colourful, most of all in the dark. */
const lampBoost = (night: boolean) => (night ? 2.6 : 1.7)

/** Sun (with shadows sized to the map), hemisphere fill and fog from the map's lighting block. */
export function createLighting(map: MapDef, scene: THREE.Scene): THREE.DirectionalLight {
  const l = gradeLighting(map.lighting)
  const boost = lampBoost(isNight(map.lighting))
  scene.fog = new THREE.Fog(l.fogColor, l.fogNear, l.fogFar)
  scene.add(new THREE.HemisphereLight(l.skyColor, l.groundColor, l.ambientIntensity))

  // Fit the shadow camera around every box so the whole map gets shadows from one map.
  const bounds = new THREE.Box3()
  for (const box of map.boxes) {
    const half = new THREE.Vector3(...box.size).multiplyScalar(0.5)
    const center = new THREE.Vector3(...box.center)
    bounds.expandByPoint(center.clone().sub(half)).expandByPoint(center.clone().add(half))
  }
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())

  const sun = new THREE.DirectionalLight(l.sunColor, l.sunIntensity)
  const dir = new THREE.Vector3(...l.sunDirection).normalize()
  sun.position.copy(sphere.center).addScaledVector(dir, sphere.radius * 1.5)
  sun.target.position.copy(sphere.center)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  const cam = sun.shadow.camera
  cam.left = cam.bottom = -sphere.radius
  cam.right = cam.top = sphere.radius
  cam.near = 0.5
  cam.far = sphere.radius * 3.5
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.03
  scene.add(sun, sun.target)

  // The map's own lamps (no shadows: cheap, and the sun does the shadow work). Spot lamps are
  // few and stay; point lamps share a pool of POINT_POOL lights handed to the lamps nearest the
  // camera, since every light costs every pixel of every lit surface, lit or not.
  const lamps = map.lights ?? []
  for (const l of lamps) {
    if (l.kind !== 'spot') continue
    const light = new THREE.SpotLight(
      tuned(l.color, 1.5, 1),
      l.intensity * boost,
      l.distance,
      ((l.angleDeg ?? 45) * Math.PI) / 180,
      0.5,
      2,
    )
    light.position.set(...l.pos)
    light.target.position.set(l.pos[0], 0, l.pos[2])
    scene.add(light, light.target)
  }
  const points = [...lamps.entries()].filter(([, l]) => l.kind !== 'spot')
  const pool: { light: THREE.PointLight; source: number; fade: number }[] = []
  for (let i = 0; i < Math.min(POINT_POOL, points.length); i++) {
    const light = new THREE.PointLight(0xffffff, 0, 10, 2)
    scene.add(light)
    pool.push({ light, source: -1, fade: 0 })
  }
  if (pool.length === 0) return sun

  let sinceAssign = 1
  let last = performance.now()
  const eye = new THREE.Vector3()
  const before = scene.onBeforeRender.bind(scene)
  scene.onBeforeRender = (renderer, sceneArg, camera, ...rest) => {
    before(renderer, sceneArg, camera, ...rest)
    const now = performance.now()
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    camera.getWorldPosition(eye)
    sinceAssign += dt
    if (sinceAssign > 0.2) {
      sinceAssign = 0
      // The lamps whose light reaches nearest to you.
      const wanted = new Set(
        points
          .map(([index, l]) => ({
            index,
            d: Math.hypot(l.pos[0] - eye.x, l.pos[1] - eye.y, l.pos[2] - eye.z) - l.distance,
          }))
          .sort((a, b) => a.d - b.d)
          .slice(0, pool.length)
          .map((n) => n.index),
      )
      for (const slot of pool) {
        if (slot.source >= 0 && wanted.has(slot.source)) wanted.delete(slot.source)
        else slot.source = -1
      }
      for (const index of wanted) {
        const slot = pool.find((s) => s.source < 0)
        const l = lamps[index]
        if (!slot || !l) break
        slot.source = index
        slot.fade = 0
        slot.light.color.setHex(tuned(l.color, 1.5, 1))
        slot.light.distance = l.distance * 1.15
        slot.light.position.set(...l.pos)
      }
    }
    const t = now / 1000
    for (const slot of pool) {
      const l = slot.source >= 0 ? lamps[slot.source] : undefined
      if (!l) {
        slot.light.intensity = 0
        continue
      }
      // Newly lit lamps come up over a moment instead of popping on.
      slot.fade = Math.min(1, slot.fade + dt * 4)
      const flicker = l.flicker ? flickerLevel(t, slot.source * 7.31, l.flicker) : 1
      slot.light.intensity = l.intensity * boost * flicker * slot.fade
      if (l.hang) {
        // Lamps on cords carry their light as they swing (see swingLamps).
        hangingLightPos(l, slot.source, wind.time, false, slot.light.position)
        slot.light.updateMatrixWorld()
      }
    }
  }
  return sun
}

/** Brightness (0–1) of a flickering lamp at time `t`: mostly on, with stutters and dropouts. */
export function flickerLevel(t: number, seed: number, amount: number): number {
  const hash = (n: number) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  // A burst of trouble every few seconds…
  const slot = Math.floor(t / 2.5 + seed)
  if (hash(slot) > amount) return 0.95 + 0.05 * hash(Math.floor(t * 20))
  // …in which it stutters on and off in quick steps.
  const step = hash(Math.floor(t * 14) + slot * 0.37)
  return step < 0.45 ? 0.05 + step * 0.3 : 1
}

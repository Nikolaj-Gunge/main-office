import type { MapDef, MapLighting } from '@office-fps/shared'
import * as THREE from 'three'

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

  // The map's own lamps (no shadows: cheap, and the sun does the shadow work).
  const flickering: { light: THREE.Light; base: number; amount: number; seed: number }[] = []
  for (const l of map.lights ?? []) {
    const light =
      l.kind === 'spot'
        ? new THREE.SpotLight(
            tuned(l.color, 1.5, 1),
            l.intensity * boost,
            l.distance,
            ((l.angleDeg ?? 45) * Math.PI) / 180,
            0.5,
            2,
          )
        : new THREE.PointLight(tuned(l.color, 1.5, 1), l.intensity * boost, l.distance * 1.15, 2)
    light.position.set(...l.pos)
    if (l.flicker) {
      flickering.push({
        light,
        base: l.intensity * boost,
        amount: l.flicker,
        seed: flickering.length * 7.31,
      })
    }
    if (light instanceof THREE.SpotLight) {
      light.target.position.set(l.pos[0], 0, l.pos[2])
      scene.add(light.target)
    }
    scene.add(light)
  }
  if (flickering.length > 0) {
    // Every frame, as the scene starts to render: failing lamps stutter and drop out now and then.
    const before = scene.onBeforeRender.bind(scene)
    scene.onBeforeRender = (...args) => {
      before(...args)
      const t = performance.now() / 1000
      for (const f of flickering) f.light.intensity = f.base * flickerLevel(t, f.seed, f.amount)
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

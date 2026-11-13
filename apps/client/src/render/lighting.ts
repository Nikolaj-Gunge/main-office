import type { MapDef } from '@office-fps/shared'
import * as THREE from 'three'

/** Sun (with shadows sized to the map), hemisphere fill and fog from the map's lighting block. */
export function createLighting(map: MapDef, scene: THREE.Scene): THREE.DirectionalLight {
  const l = map.lighting
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
            l.color,
            l.intensity,
            l.distance,
            ((l.angleDeg ?? 45) * Math.PI) / 180,
            0.5,
            2,
          )
        : new THREE.PointLight(l.color, l.intensity, l.distance, 2)
    light.position.set(...l.pos)
    if (l.flicker) {
      flickering.push({ light, base: l.intensity, amount: l.flicker, seed: flickering.length * 7.31 })
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

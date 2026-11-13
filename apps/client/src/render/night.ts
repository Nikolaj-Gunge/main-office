import type { MapDef, MapLight } from '@office-fps/shared'
import * as THREE from 'three'
import { flickerLevel } from './lighting.ts'

/** Lamps lit at once: the nearest of the map's (the world has far more than a GPU wants). */
const LAMPS = 8
/** Lamps further than this (m) are off; they fade in from a little further out. */
const LAMP_RANGE = 75
/** The moon's shadows cover this far around you (m), and are redrawn when you've walked this far. */
const SHADOW_REACH = 80
const SHADOW_STEP = 20

/** The moon is this much brighter than the map's (night) sun value says. */
const MOON = 1.8

const mix = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Survival's light: a faint moon whose shadows follow you through the trees, the few lamps and
 * fires near you, fog that closes in — and the grey hour, when it all eases for a while.
 */
export class Night {
  /** True when the moon's shadow map wants redrawing this frame. */
  shadowsDirty = true
  private readonly scene: THREE.Scene
  private readonly fog: THREE.Fog
  private readonly hemi: THREE.HemisphereLight
  private readonly moon: THREE.DirectionalLight
  private readonly moonDir: THREE.Vector3
  private readonly lights: readonly MapLight[]
  private readonly pool: { light: THREE.PointLight; source: MapLight | null; index: number }[] = []
  private readonly base: MapDef['lighting']
  private readonly shadowAt = new THREE.Vector3(1e9, 0, 1e9)
  private readonly darkFog: THREE.Color
  private readonly greyFog = new THREE.Color(0x39424e)
  private readonly darkSky: THREE.Color
  private readonly greySky = new THREE.Color(0x4a5566)
  private readonly sky: { top: THREE.Color; horizon: THREE.Color } | null
  private sinceLamps = 1

  constructor(map: MapDef, scene: THREE.Scene, sky: THREE.Mesh | null) {
    this.scene = scene
    // As the map says, ungraded: the survival world's night is tuned by hand.
    const l = map.lighting
    this.base = l
    this.lights = map.lights ?? []
    this.fog = new THREE.Fog(l.fogColor, l.fogNear, l.fogFar)
    scene.fog = this.fog
    this.darkFog = new THREE.Color(l.fogColor)
    this.darkSky = new THREE.Color(l.skyColor)
    this.hemi = new THREE.HemisphereLight(l.skyColor, l.groundColor, l.ambientIntensity)
    this.moon = new THREE.DirectionalLight(l.sunColor, l.sunIntensity * MOON)
    this.moonDir = new THREE.Vector3(...l.sunDirection).normalize()
    this.moon.castShadow = true
    this.moon.shadow.mapSize.set(2048, 2048)
    const cam = this.moon.shadow.camera
    cam.left = cam.bottom = -SHADOW_REACH
    cam.right = cam.top = SHADOW_REACH
    cam.near = 1
    cam.far = 500
    this.moon.shadow.bias = -0.0008
    this.moon.shadow.normalBias = 0.06
    scene.add(this.hemi, this.moon, this.moon.target)
    for (let i = 0; i < LAMPS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2)
      scene.add(light)
      this.pool.push({ light, source: null, index: -1 })
    }
    const uniforms = (sky?.material as THREE.ShaderMaterial | undefined)?.uniforms
    this.sky = uniforms
      ? { top: uniforms.topColor?.value as THREE.Color, horizon: uniforms.horizonColor?.value as THREE.Color }
      : null
  }

  /**
   * @param grey  0 in the dark … 1 in the middle of the grey hour
   * @param moved the world around the viewer changed (new forest): redraw the shadows
   */
  update(dt: number, viewer: THREE.Vector3, grey: number, moved: boolean): void {
    // The grey hour: more fill light, fog further off and paler.
    this.hemi.intensity = this.base.ambientIntensity * mix(1, 2.6, grey)
    this.moon.intensity = this.base.sunIntensity * MOON * mix(1, 1.7, grey)
    this.fog.near = this.base.fogNear * mix(1, 2, grey)
    this.fog.far = this.base.fogFar * mix(1, 1.9, grey)
    this.fog.color.copy(this.darkFog).lerp(this.greyFog, grey * 0.55)
    this.sky?.horizon.copy(this.fog.color)
    this.sky?.top.copy(this.darkSky).lerp(this.greySky, grey * 0.5)

    // Shadows: one map around the viewer, redrawn only after walking a while.
    if (moved || Math.hypot(viewer.x - this.shadowAt.x, viewer.z - this.shadowAt.z) > SHADOW_STEP) {
      this.shadowAt.copy(viewer)
      this.moon.target.position.copy(viewer)
      this.moon.position.copy(viewer).addScaledVector(this.moonDir, 250)
      this.moon.target.updateMatrixWorld()
      this.shadowsDirty = true
    }

    this.sinceLamps += dt
    if (this.sinceLamps > 0.25) {
      this.sinceLamps = 0
      this.assignLamps(viewer)
    }
    const t = performance.now() / 1000
    for (const slot of this.pool) {
      const s = slot.source
      if (!s) continue
      const d = Math.hypot(s.pos[0] - viewer.x, s.pos[2] - viewer.z)
      const fade = Math.max(0, Math.min(1, (LAMP_RANGE - d) / 15))
      const flicker = s.flicker ? flickerLevel(t, slot.index * 7.31, s.flicker) : 1
      slot.light.intensity = s.intensity * 2.6 * fade * flicker
    }
  }

  /** Hands the pool's lights to the map lamps nearest the viewer (keeping the ones already lit). */
  private assignLamps(viewer: THREE.Vector3): void {
    const near: { d: number; i: number }[] = []
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i] as MapLight
      const d = Math.hypot(l.pos[0] - viewer.x, l.pos[2] - viewer.z)
      if (d < LAMP_RANGE) near.push({ d, i })
    }
    near.sort((a, b) => a.d - b.d)
    const wanted = new Set(near.slice(0, LAMPS).map((n) => n.i))
    for (const slot of this.pool) {
      if (wanted.has(slot.index)) wanted.delete(slot.index)
      else {
        slot.source = null
        slot.index = -1
        slot.light.intensity = 0
      }
    }
    for (const i of wanted) {
      const slot = this.pool.find((s) => !s.source)
      const l = this.lights[i]
      if (!slot || !l) break
      slot.source = l
      slot.index = i
      slot.light.color.setHex(l.color)
      slot.light.distance = l.distance * 1.15
      slot.light.position.set(...l.pos)
    }
  }

  dispose(): void {
    this.scene.remove(this.hemi, this.moon, this.moon.target)
    for (const slot of this.pool) this.scene.remove(slot.light)
  }
}

import {
  DAWN,
  daylight,
  type MapDef,
  type MapLight,
  NIGHTFALL,
  sunProgress,
  valueNoise,
} from '@office-fps/shared'
import * as THREE from 'three'
import { flickerLevel } from './lighting.ts'
import { hangingLightPos, wind } from './wind.ts'

/** Lamps lit at once: the nearest of the map's (the world has far more than a GPU wants). */
const LAMPS = 6
/** Lamps further than this (m) are off; they fade in from a little further out. */
const LAMP_RANGE = 75
/** The moon's shadows cover this far around you (m), and are redrawn when you've walked this far. */
const SHADOW_REACH = 80
const SHADOW_STEP = 20

/** The moon is this much brighter than the map's (night) sun value says. */
const MOON = 1.8

const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Daylight in Deadwood: grey, overcast, the fog never quite lifting. */
const DAY = {
  sky: new THREE.Color(0x6f8496),
  hemiSky: new THREE.Color(0xb8c4cc),
  hemiGround: new THREE.Color(0x3a3a2a),
  ambient: 1.9,
  sun: new THREE.Color(0xfff0d8),
  sunIntensity: 2.4,
  fog: new THREE.Color(0x8d989c),
  fogNear: 40,
  /** Far, now that the distant forest is cheap (see forest-lod.ts); night stays at the map's. */
  fogFar: 420,
}
/** The low sun at dawn and dusk tints the fog and sky. */
const EMBER = new THREE.Color(0xc8784a)

/** What the weather does to the light (see weather-view.ts). All 0–1. */
export interface SkyWeather {
  cloud: number
  rain: number
  fog: number
  /** Lightning lighting everything up right now. */
  flash: number
}

/** Under heavy cloud and rain by day: a low, wet grey. */
const RAIN_SKY = new THREE.Color(0x4a535c)
const RAIN_FOG = new THREE.Color(0x5c6468)
/**
 * Fog is lit: paler than the dark around it. At night a dim moonlit grey that trees fade into
 * as dark shapes, while the ground at your feet stays as dark as ever.
 */
const FOG_DAY = new THREE.Color(0x9aa3a6)
const FOG_NIGHT = new THREE.Color(0x2c3540)
/** A lightning flash: the whole sky goes blue-white. */
const FLASH_SKY = new THREE.Color(0xc4d0f4)
const FLASH_LIGHT = new THREE.Color(0xdfe6ff)

/**
 * Survival's light: a faint moon whose shadows follow you through the trees, the few lamps and
 * fires near you, fog that closes in — and the grey, overcast day that comes round in between.
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
  private readonly darkSky: THREE.Color
  private readonly darkHemiSky: THREE.Color
  private readonly darkHemiGround: THREE.Color
  private readonly moonColor: THREE.Color
  private readonly sunDir = new THREE.Vector3()
  private readonly lightDir = new THREE.Vector3()
  private readonly shadowDir = new THREE.Vector3()
  private readonly sky: { top: THREE.Color; horizon: THREE.Color } | null
  private sinceLamps = 1
  /** Lamps count for less in daylight. */
  private lampLevel = 1
  private weather: SkyWeather = { cloud: 0, rain: 0, fog: 0, flash: 0 }

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
    this.darkHemiSky = new THREE.Color(l.skyColor)
    this.darkHemiGround = new THREE.Color(l.groundColor)
    this.moonColor = new THREE.Color(l.sunColor)
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
      ? {
          top: uniforms.topColor?.value as THREE.Color,
          horizon: uniforms.horizonColor?.value as THREE.Color,
        }
      : null
  }

  /** The weather to light the world for, from the next update on. */
  setWeather(weather: SkyWeather): void {
    this.weather = weather
  }

  /**
   * @param time  the day's clock (SurvivalShared.time)
   * @param moved the world around the viewer changed (new forest): redraw the shadows
   */
  update(dt: number, viewer: THREE.Vector3, time: number, moved: boolean): void {
    const day = daylight(time)
    this.lampLevel = 1 - day * 0.7
    const u = ((time % 1) + 1) % 1
    // Dawn and dusk glow: strongest halfway through each.
    const low = u >= DAWN && u < NIGHTFALL ? Math.sin(Math.min(1, Math.max(0, day)) * Math.PI) : 0
    const w = this.weather
    // Cloud hides the moon and dims the sun; rain greys everything; lightning lights it all up.
    const grey = Math.min(1, w.cloud * 0.6 + w.rain * 0.4)
    this.hemi.intensity =
      mix(this.base.ambientIntensity, DAY.ambient, day) * (1 - w.rain * 0.2) + w.flash * 2.2
    this.hemi.color.copy(this.darkHemiSky).lerp(DAY.hemiSky, day)
    this.hemi.groundColor.copy(this.darkHemiGround).lerp(DAY.hemiGround, day)
    this.moon.intensity =
      mix(this.base.sunIntensity * MOON, DAY.sunIntensity, day) * (1 - w.cloud * 0.55) +
      w.flash * 4.5
    this.moon.color
      .copy(this.moonColor)
      .lerp(DAY.sun, day)
      .lerp(EMBER, low * 0.5 * (1 - grey))
      .lerp(FLASH_LIGHT, Math.min(1, w.flash * 1.5))
    // Fog weather closes in; rain does a little. Fog lies in banks: walk into one, out again.
    const bank = 0.5 + 0.5 * valueNoise(viewer.x / 110 + wind.time * 0.004, viewer.z / 110, 77)
    const thick = (1 - w.fog * (0.5 + 0.25 * bank)) * (1 - w.rain * 0.3)
    // (At night the first few metres stay clear: the fog is out there, not in your face.)
    this.fog.near = mix(this.base.fogNear, DAY.fogNear, day) * (1 - w.fog * mix(0.5, 0.8, day))
    this.fog.far = mix(this.base.fogFar, DAY.fogFar, day) * thick
    this.fog.color
      .copy(this.darkFog)
      .lerp(DAY.fog, day)
      .lerp(RAIN_FOG, grey * day * 0.7)
      .lerp(EMBER, low * 0.35 * (1 - grey))
      .lerp(day > 0.5 ? FOG_DAY : FOG_NIGHT, w.fog * mix(0.85, 0.5, day))
      .lerp(FLASH_SKY, w.flash * 0.45)
    this.sky?.horizon.copy(this.fog.color)
    this.sky?.top
      .copy(this.darkSky)
      .multiplyScalar(1 - w.cloud * 0.45)
      .lerp(DAY.sky, day)
      .lerp(RAIN_SKY, grey * day * 0.8)
      // In thick fog there's no sky to speak of: only more fog.
      .lerp(this.fog.color, w.fog * 0.7)
      .lerp(FLASH_SKY, w.flash * 0.75)

    // The sun crosses from east to west by day; at night the moon hangs where the map put it.
    const p = sunProgress(u)
    if (day > 0.02 && p > 0 && p < 1) {
      const elevation = Math.sin(p * Math.PI) * 0.95 + 0.12
      this.sunDir.set(Math.cos(p * Math.PI), Math.sin(elevation), 0.35).normalize()
      this.lightDir
        .copy(this.moonDir)
        .lerp(this.sunDir, Math.min(1, day * 2))
        .normalize()
    } else this.lightDir.copy(this.moonDir)
    // A sun that has moved a degree or two wants its shadows redrawn.
    if (this.lightDir.angleTo(this.shadowDir) > 0.03) {
      this.shadowDir.copy(this.lightDir)
      moved = true
    }

    // Shadows: one map around the viewer, redrawn only after walking a while.
    if (moved || Math.hypot(viewer.x - this.shadowAt.x, viewer.z - this.shadowAt.z) > SHADOW_STEP) {
      this.shadowAt.copy(viewer)
      this.moon.target.position.copy(viewer)
      this.moon.position.copy(viewer).addScaledVector(this.lightDir, 250)
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
      // By day a lamp hardly shows.
      slot.light.intensity = s.intensity * 2.6 * fade * flicker * this.lampLevel
      // Lanterns swing in the wind, and their light with them.
      if (s.hang) hangingLightPos(s, slot.index, wind.time, true, slot.light.position)
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

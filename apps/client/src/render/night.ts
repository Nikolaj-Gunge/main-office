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
import { cascadeReaches, cascadeStep, snapToTexel } from './cascades.ts'
import { flickerLevel } from './lighting.ts'
import { hangingLightPos, wind } from './wind.ts'

/**
 * Lamps lit at once: the nearest of the map's (the world has far more than a GPU wants). The
 * device tier can light fewer (setTier).
 */
const LAMPS = 6
/**
 * Inside a safe camp (Haven) a few more: it is full of lamps, braziers and the bonfire. The extra
 * lights are switched off (not just dimmed) elsewhere so the rest of the woods don't pay for them.
 */
const CAMP_LAMPS = 9
/** Lamps further than this (m) are off; they fade in from a little further out. */
const LAMP_RANGE = 75
/**
 * The moon's shadows cover this far around you (m) until the device tier says otherwise; with
 * cascades (cascades.ts) the nearest map covers less and further ones more.
 */
const SHADOW_REACH = 80
/** Shadow bias along the surface normal (m), at least, and in texels of a coarser cascade. */
const NORMAL_BIAS = 0.06
const NORMAL_BIAS_TEXELS = 0.8

/** One shadow cascade: a light that follows you, redrawn after you've walked `step` m. */
interface Cascade {
  light: THREE.DirectionalLight
  reach: number
  step: number
  at: THREE.Vector3
}

/** The moon is this much brighter than the map's (night) sun value says. */
const MOON = 1.8
/** How much brighter a lamp burns than the map says (it used to be 2.6, which glared). */
const LAMP_BOOST = 1.8
/**
 * Lamps are drawn towards a plain warm white by this much, so a red or green bulb reads as a
 * tint rather than a disco light.
 */
const LAMP_TINT = 0.5
const LAMP_WHITE = new THREE.Color(0xffe4c4)

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
  /** × the dark's ambient light (Night Owl, legacy.ts: a little more); full day is unchanged. */
  vision = 1
  private readonly moon: THREE.DirectionalLight
  private readonly moonDir: THREE.Vector3
  private readonly lights: readonly MapLight[]
  /** Safe camps (x, z, radius): more lamps are lit inside. */
  private readonly camps: { x: number; z: number; r: number }[]
  private readonly pool: { light: THREE.PointLight; source: MapLight | null; index: number }[] = []
  private readonly base: MapDef['lighting']
  /** The moon's shadow, nearest cascade first (the first is the moon itself; see cascades.ts). */
  private cascades: Cascade[] = []
  /** Lights made for further cascades, kept when a lower tier hides them. */
  private readonly spareLights: THREE.DirectionalLight[] = []
  private readonly snapped = new THREE.Vector3()
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
  /** Lamps lit at once, out in the woods and in a camp (the device tier's). */
  private lamps = LAMPS
  private campLamps = CAMP_LAMPS
  /** The day's haze reaches no further than this (m). */
  private fogCap = Number.POSITIVE_INFINITY

  constructor(map: MapDef, scene: THREE.Scene, sky: THREE.Mesh | null) {
    this.scene = scene
    // As the map says, ungraded: the survival world's night is tuned by hand.
    const l = map.lighting
    this.base = l
    this.lights = map.lights ?? []
    this.camps = (map.survival?.pois ?? [])
      .filter((p) => p.safe)
      .map((p) => ({ x: p.x, z: p.z, r: p.r + 15 }))
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
    setupShadow(this.moon, 2048, SHADOW_REACH)
    scene.add(this.hemi, this.moon, this.moon.target)
    this.cascades = [{ light: this.moon, reach: SHADOW_REACH, step: 20, at: far() }]
    for (let i = 0; i < CAMP_LAMPS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2)
      light.visible = i < LAMPS
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

  /** What the device tier allows: shadow maps and cascades, lamps, how far the haze lifts. */
  setTier(t: {
    shadowMap: number
    shadowReach: number
    shadowCascades: readonly number[]
    lamps: number
    campLamps: number
    fogFar: number
  }): void {
    const reaches = cascadeReaches(t.shadowCascades, t.shadowReach)
    // The moon is the first cascade; further ones are lights of their own that carry no light.
    while (this.spareLights.length < reaches.length - 1) {
      const light = new THREE.DirectionalLight(0xffffff, 0)
      this.spareLights.push(light)
      this.scene.add(light, light.target)
    }
    this.cascades = reaches.map((reach, k) => {
      const light = k === 0 ? this.moon : (this.spareLights[k - 1] as THREE.DirectionalLight)
      setupShadow(light, t.shadowMap, reach)
      light.visible = true
      return { light, reach, step: cascadeStep(reach, reaches.length), at: far() }
    })
    // (Hiding a light changes the shaders once; three keeps both versions.)
    for (const light of this.spareLights.slice(reaches.length - 1)) {
      light.visible = false
      light.shadow.map?.dispose()
      light.shadow.map = null
    }
    this.lamps = Math.min(LAMPS, t.lamps)
    this.campLamps = Math.min(CAMP_LAMPS, t.campLamps)
    this.fogCap = t.fogFar
    this.sinceLamps = 1
    this.shadowsDirty = true
  }

  /** For the mist (fog-atmosphere.ts): the lamps in use, the moon, and the fog as it is now. */
  get litLamps(): THREE.PointLight[] {
    return this.pool.filter((s) => s.source !== null).map((s) => s.light)
  }
  get moonLight(): THREE.DirectionalLight {
    return this.moon
  }
  get distanceFog(): THREE.Fog {
    return this.fog
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
      mix(this.base.ambientIntensity, DAY.ambient, day) *
        (1 - w.rain * 0.2) *
        (1 + (this.vision - 1) * (1 - day)) +
      w.flash * 2.2
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
    this.fog.far = Math.min(this.fogCap, mix(this.base.fogFar, DAY.fogFar, day)) * thick
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

    // Shadows: maps around the viewer, each redrawn only after walking a while (the near one
    // sooner, the far one seldom), on its own texel grid so edges stay put between redraws.
    for (const c of this.cascades) {
      if (!moved && Math.hypot(viewer.x - c.at.x, viewer.z - c.at.z) <= c.step) continue
      c.at.copy(viewer)
      const texel = (c.reach * 2) / c.light.shadow.mapSize.x
      snapToTexel(viewer, this.lightDir, texel, this.snapped)
      c.light.target.position.copy(this.snapped)
      c.light.position.copy(this.snapped).addScaledVector(this.lightDir, 250)
      c.light.target.updateMatrixWorld()
      c.light.shadow.needsUpdate = true
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
      // A gentler flicker than the map asks for: fewer bursts, and they dim rather than go out.
      const flicker = s.flicker
        ? 0.55 + 0.45 * flickerLevel(t, slot.index * 7.31, s.flicker * 0.5)
        : 1
      // By day a lamp hardly shows.
      slot.light.intensity = s.intensity * LAMP_BOOST * fade * flicker * this.lampLevel
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
    const inCamp = this.camps.some((c) => Math.hypot(c.x - viewer.x, c.z - viewer.z) < c.r)
    const count = inCamp ? this.campLamps : this.lamps
    const wanted = new Set(near.slice(0, count).map((n) => n.i))
    for (const [k, slot] of this.pool.entries()) {
      // (Turning a light on or off changes the shaders once; three keeps both versions.)
      slot.light.visible = k < count
      if (wanted.has(slot.index) && k < count) wanted.delete(slot.index)
      else {
        slot.source = null
        slot.index = -1
        slot.light.intensity = 0
      }
    }
    for (const i of wanted) {
      const slot = this.pool.find((s) => !s.source && s.light.visible)
      const l = this.lights[i]
      if (!slot || !l) break
      slot.source = l
      slot.index = i
      slot.light.color.setHex(l.color).lerp(LAMP_WHITE, LAMP_TINT)
      slot.light.distance = l.distance * 1.15
      slot.light.position.set(...l.pos)
    }
  }

  dispose(): void {
    this.scene.remove(this.hemi, this.moon, this.moon.target)
    for (const light of this.spareLights) this.scene.remove(light, light.target)
    for (const slot of this.pool) this.scene.remove(slot.light)
  }
}

const far = () => new THREE.Vector3(1e9, 0, 1e9)

/**
 * A cascade's shadow: `size` texels a side covering `reach` m around its target, redrawn only
 * when asked (Night.update). A new size wants a new map (made again on the next shadow draw).
 */
function setupShadow(light: THREE.DirectionalLight, size: number, reach: number): void {
  light.castShadow = true
  const shadow = light.shadow
  if (shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size)
    shadow.map?.dispose()
    shadow.map = null
  }
  const cam = shadow.camera
  cam.left = cam.bottom = -reach
  cam.right = cam.top = reach
  cam.near = 1
  cam.far = 500
  cam.updateProjectionMatrix()
  shadow.bias = -0.0008
  shadow.normalBias = Math.max(NORMAL_BIAS, ((reach * 2) / size) * NORMAL_BIAS_TEXELS)
  shadow.autoUpdate = false
  shadow.needsUpdate = true
}

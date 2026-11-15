import type { Lake } from '@office-fps/shared'
import * as THREE from 'three'
import type { Tier } from './device-tier.ts'

/**
 * The mist that lies in the woods at night (volumetric-fog.ts draws it): how thick it is, where
 * it pools, and what lights it. Worked out here, away from the GPU, so it can be tested.
 *
 * - `off`: only the plain distance fog every material already has (three's Fog).
 * - `height`: low mist that pools in hollows and over the lake, lamp halos, your torch's cone.
 * - `full`: the same, marched in more steps, with moonlight falling through the canopy in shafts.
 */
export type FogMode = 'off' | 'height' | 'full'

export interface FogTier {
  mode: FogMode
  /** Samples along each ray (0 when off). */
  steps: number
  /** Game pixels per mist pixel a side (the mist is drawn this much coarser, upscaled nearest). */
  scale: number
  /** Moonlight shafts (the moon's shadow map sampled along the ray). */
  shafts: boolean
}

/** Low pays nothing; Medium gets the mist and its halos; High the full march with shafts. */
export const FOG_TIERS: Record<Tier, FogTier> = {
  low: { mode: 'off', steps: 0, scale: 2, shafts: false },
  medium: { mode: 'height', steps: 6, scale: 2, shafts: false },
  high: { mode: 'full', steps: 14, scale: 2, shafts: true },
}

/** The weather as the night sees it (night.ts's SkyWeather): all 0–1. */
export interface FogWeather {
  cloud: number
  rain: number
  fog: number
}

/** Mist never gets thicker than this (extinction per metre at the mist line). */
export const MAX_DENSITY = 0.09

/**
 * How thick the mist is at the mist line (extinction per metre). A thin mist always lies in the
 * hollows, more after dark; fog weather brings it down hard, rain a little; the Rot's Fog Night
 * (`mood`, 0–1) only at night.
 */
export function fogDensity(w: FogWeather, mood: number, day: number): number {
  const night = 1 - Math.min(1, Math.max(0, day))
  const base = 0.004 + 0.01 * night
  const weather = 0.035 * w.fog + 0.012 * w.rain + 0.003 * w.cloud
  const rot = 0.05 * Math.max(0, mood) * night
  return Math.min(MAX_DENSITY, base + weather + rot)
}

/** How quickly the mist thins with height above the mist line (m: e-folding height). */
export const MIST_HEIGHT = 5

/**
 * The height mist settles at around (x, z): the lie of the land about you (a ring 60 m and
 * 130 m out, and underfoot) less a little. Ground below it is a hollow and fills with mist;
 * a hilltop stands clear of it.
 */
export function mistLine(height: (x: number, z: number) => number, x: number, z: number): number {
  let sum = height(x, z)
  let n = 1
  for (const r of [60, 130]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      sum += height(x + Math.cos(a) * r, z + Math.sin(a) * r)
      n++
    }
  }
  return sum / n - 1.5
}

/** Lakes whose mist could be seen from (x, z): the nearest `max` within `range` m of the shore. */
export function nearLakes(
  lakes: readonly Lake[],
  x: number,
  z: number,
  max = 2,
  range = 300,
): Lake[] {
  return lakes
    .map((l) => ({ l, d: Math.hypot(l.x - x, l.z - z) - l.r }))
    .filter((e) => e.d < range)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.l)
}

/** Everything the mist pass needs for a frame. */
export interface FogFrame {
  tier: FogTier
  /** Extinction per metre at the mist line. */
  density: number
  /** The mist line (world y) and how fast it thins above it (m). */
  base: number
  height: number
  /** Rays stop here (m): the distance fog has swallowed everything past it anyway. */
  far: number
  /** The dim light the mist scatters everywhere (linear). */
  color: THREE.Color
  /** More of it over the lakes (linear): pale water mist that shows even under a black sky. */
  lakeGlow: THREE.Color
  /** Lamps lit near you (night.ts's pool): each gets a halo. */
  lamps: readonly THREE.PointLight[]
  /** Your torch (null: none). */
  torch: THREE.SpotLight | null
  /** The moon (by day the sun), whose shadow map makes the shafts; how strongly they show (0–1). */
  moon: THREE.DirectionalLight | null
  moonLevel: number
  lakes: readonly Lake[]
  /** Seconds, for the mist's slow drift. */
  time: number
}

/** How much brighter than the distance fog the mist glows (it is lit, the dark is not). */
const MIST_LIFT = 1.8
/** Moonlight the mist gives back everywhere, per unit of the moon's intensity. */
const MOON_GLOW = 0.03
/** The mist line is looked for again this often (s), and eases towards it. */
const LINE_EVERY = 0.5

/**
 * Light the mist over water gives back at night, whatever the cloud (open water holds what
 * little light there is): enough to show as a pale bank, not to light anything.
 */
export const LAKE_GLOW = new THREE.Color(0.016, 0.019, 0.024)

const moonGlow = new THREE.Color()

/** Keeps a FogFrame up to date from the night, the weather and the Rot. */
export class Atmosphere {
  readonly frame: FogFrame
  private sinceLine = LINE_EVERY
  private lineTarget: number | null = null

  constructor(
    private readonly height: (x: number, z: number) => number,
    private readonly lakes: readonly Lake[],
  ) {
    this.frame = {
      tier: FOG_TIERS.low,
      density: 0,
      base: 0,
      height: MIST_HEIGHT,
      far: 120,
      color: new THREE.Color(),
      lakeGlow: new THREE.Color(),
      lamps: [],
      torch: null,
      moon: null,
      moonLevel: 0,
      lakes: [],
      time: 0,
    }
  }

  setTier(tier: Tier): void {
    this.frame.tier = FOG_TIERS[tier]
  }

  update(
    dt: number,
    eye: THREE.Vector3,
    o: {
      weather: FogWeather
      /** The Rot's Fog Night, 0–1. */
      mood: number
      day: number
      fogColor: THREE.Color
      fogFar: number
      lamps: readonly THREE.PointLight[]
      torch: THREE.SpotLight | null
      moon: THREE.DirectionalLight
    },
  ): void {
    const f = this.frame
    f.time += dt
    if (f.tier.mode === 'off') return
    this.sinceLine += dt
    if (this.sinceLine >= LINE_EVERY || this.lineTarget === null) {
      const first = this.lineTarget === null
      this.sinceLine = 0
      this.lineTarget = mistLine(this.height, eye.x, eye.z)
      f.lakes = nearLakes(this.lakes, eye.x, eye.z)
      if (first) f.base = this.lineTarget
    }
    f.base += (this.lineTarget - f.base) * Math.min(1, dt * 0.8)
    f.density = fogDensity(o.weather, o.mood, o.day)
    // A little past the distance fog's end: mist over a lake shows as a pale bank beyond it.
    f.far = Math.max(60, Math.min(160, o.fogFar * 1.5))
    f.lamps = o.lamps
    f.torch = o.torch && o.torch.intensity > 0.5 ? o.torch : null
    f.moon = o.moon
    // Shafts show at night (by day the haze is even), less under cloud.
    f.moonLevel = (1 - Math.min(1, o.day) * 0.7) * (1 - o.weather.cloud * 0.7)
    moonGlow.copy(o.moon.color).multiplyScalar(o.moon.intensity * MOON_GLOW * f.moonLevel)
    f.color.copy(o.fogColor).multiplyScalar(MIST_LIFT).add(moonGlow)
    // By day the haze is lit anyway; under heavy fog the whole world is mist already.
    f.lakeGlow.copy(LAKE_GLOW).multiplyScalar((1 - Math.min(1, o.day)) * (1 - o.weather.fog * 0.6))
  }
}

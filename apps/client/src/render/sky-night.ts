import { DAWN, NIGHTFALL } from '@office-fps/shared'
import * as THREE from 'three'

/**
 * The night sky and the day's colour script: a blocky moon that crosses the sky each night and
 * waxes and wanes over MOON_CYCLE nights, pixel stars that wheel slowly round the pole and hide
 * behind cloud and fog, and a run of tints over the day (dusk amber, a blue night, a grey hour
 * before dawn, a warm dawn) that night.ts lays over its sky, fog and ambient light. Worked out
 * here, away from the GPU, so it can be tested; sky.ts draws it.
 */

/** Nights from one new moon to the next. */
export const MOON_CYCLE = 8
/** The first night (world day 0) has a moon just past half: something to see by. */
const FIRST_PHASE = 3

/** The moon's phase on world day `day` (CampShared.day): 0 new, 0.5 full, round to 1. */
export function moonPhase(day: number): number {
  const n = Math.floor(day) + FIRST_PHASE
  return (((n % MOON_CYCLE) + MOON_CYCLE) % MOON_CYCLE) / MOON_CYCLE
}

/** How much of the moon's face is lit (0 new … 1 full). */
export function moonLit(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
}

/**
 * How far through the night the clock `u` (0–1) is: 0 at nightfall, 1 at dawn. Outside the night
 * it holds at the nearer end (the moon waits low in the east at dusk and in the west at dawn).
 */
export function nightProgress(u: number): number {
  const w = ((u % 1) + 1) % 1
  const length = 1 - NIGHTFALL + DAWN
  const since = (w - NIGHTFALL + 1) % 1
  if (since <= length) return since / length
  // By day: whichever end is nearer.
  return since - length < (1 - length) / 2 ? 1 : 0
}

/** The moon's lowest and highest (rad) on its way across: never so low it darkens the woods. */
const MOON_LOW = 0.7
const MOON_HIGH = 1.05

/**
 * Towards the moon at clock `u`: it rises in the east (+x, where the sun comes up), climbs to
 * about 60° at midnight and sets in the west, a little to the south (+z) as the map's moon was.
 */
export function moonDirection(u: number, out: THREE.Vector3): THREE.Vector3 {
  const p = nightProgress(u)
  const elevation = MOON_LOW + (MOON_HIGH - MOON_LOW) * Math.sin(p * Math.PI)
  const flat = Math.cos(elevation)
  const x = Math.cos(p * Math.PI)
  const z = 0.45
  const len = Math.hypot(x, z)
  return out.set((x / len) * flat, Math.sin(elevation), (z / len) * flat)
}

/** One stop in the colour script: from clock `u` on, lean towards `tint` by `k`. */
interface Grade {
  u: number
  tint: THREE.Color
  /** How far towards the tint (0–1). */
  k: number
  /** × the colour's brightness while tinting (1: the same brightness, only the hue moves). */
  gain: number
}

const grade = (u: number, hex: number, k: number, gain = 1): Grade => ({
  u,
  tint: new THREE.Color(hex),
  k,
  gain,
})

/**
 * The colour script, by the clock (stops past 1 are the small hours of the next day). Warm and
 * unsaturated: the tints move the hue more than the brightness, and never all the way.
 */
const SCRIPT: Grade[] = [
  grade(0.8, 0x8d989c, 0),
  // Dusk: a dull amber low light.
  grade(0.88, 0xb09070, 0.14),
  grade(0.93, 0xa88468, 0.26),
  // The blue hour just after dark, settling into a cold blue night.
  grade(0.985, 0x3c4670, 0.4, 1.12),
  grade(1.08, 0x2e3e60, 0.34),
  grade(1.26, 0x2e3c58, 0.3, 0.96),
  // The grey hour before dawn: the sky pales before anything is lit.
  grade(1.34, 0x60646a, 0.5, 1.3),
  // Dawn: rose-grey, then warm.
  grade(1.4, 0x8a7a72, 0.36, 1.2),
  grade(1.445, 0xb89878, 0.26, 1.04),
  grade(1.52, 0xb8a080, 0.06),
  grade(1.56, 0x8d989c, 0),
  grade(1.8, 0x8d989c, 0),
]

/** The colour script at clock `u`, written into `out`. */
export function colourScript(u: number, out: Grade = grade(0, 0, 0)): Grade {
  let w = ((u % 1) + 1) % 1
  if (w < 0.8) w += 1
  for (let i = 1; i < SCRIPT.length; i++) {
    const a = SCRIPT[i - 1] as Grade
    const b = SCRIPT[i] as Grade
    if (w > b.u) continue
    const t = (w - a.u) / (b.u - a.u)
    out.u = w
    // Fade the tint in with its weight, so a stop with k = 0 doesn't drag the hue.
    out.tint.copy(a.tint).lerp(b.tint, a.k + b.k > 0 ? (b.k * t) / (a.k * (1 - t) + b.k * t) : t)
    out.k = a.k + (b.k - a.k) * t
    out.gain = a.gain + (b.gain - a.gain) * t
    return out
  }
  out.k = 0
  return out
}

const tinted = new THREE.Color()

/** Leans `color` towards the script's tint by `k` × `weight`, keeping its brightness (× gain). */
export function applyGrade(color: THREE.Color, g: Grade, weight: number): void {
  const k = g.k * weight
  if (k <= 0) return
  const lum = luminance(color)
  const tl = luminance(g.tint)
  if (tl <= 0) return
  const gain = 1 + (g.gain - 1) * weight
  tinted.copy(g.tint).multiplyScalar((lum * gain) / tl)
  color.lerp(tinted, k)
}

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

/** The sky dome's night uniforms (sky.ts). */
export interface NightSkyUniforms {
  moonDir: { value: THREE.Vector3 }
  moonPhase: { value: number }
  moonAlpha: { value: number }
  moonColor: { value: THREE.Color }
  starAlpha: { value: number }
  starTurn: { value: THREE.Matrix3 }
}

/** The moon's own colour: a warm, pale bone. */
export const MOON_COLOR = new THREE.Color(0xd2c8ae)
/** The pole the stars wheel round (tilted, as from somewhere in the north). */
const POLE = new THREE.Vector3(0.25, 0.8, -0.55).normalize()
const turn = new THREE.Matrix4()

/** The weather as the sky sees it: all 0–1. */
export interface SkyCover {
  cloud: number
  fog: number
}

/**
 * Sets the dome's moon and stars for clock `u`, `day` (daylight 0–1), the world day `worldDay`
 * and the weather. Stars and the moon only come out in the dark, and cloud and fog hide them.
 */
export function updateNightSky(
  sky: NightSkyUniforms,
  u: number,
  day: number,
  worldDay: number,
  cover: SkyCover,
): void {
  const dark = 1 - Math.min(1, Math.max(0, day))
  moonDirection(u, sky.moonDir.value)
  sky.moonPhase.value = moonPhase(worldDay)
  sky.moonColor.value.copy(MOON_COLOR)
  const clear = 1 - Math.min(1, cover.fog * 1.4)
  sky.moonAlpha.value = Math.min(1, dark * 1.6) * (1 - cover.cloud * 0.75) * clear
  // (They go out first in the grey before dawn.)
  const fading = 1 - Math.max(0, Math.min(1, (nightProgress(u) - 0.8) / 0.2)) * 0.7
  sky.starAlpha.value = dark * dark * fading * Math.max(0, 1 - cover.cloud * 1.3) * clear
  // Once round the pole a day: slow enough that you notice only when you look again.
  turn.makeRotationAxis(POLE, -(((u % 1) + 1) % 1) * Math.PI * 2)
  sky.starTurn.value.setFromMatrix4(turn)
}

/** Fresh uniforms for the dome. */
export function nightSkyUniforms(): NightSkyUniforms {
  return {
    moonDir: { value: new THREE.Vector3(0, 1, 0) },
    moonPhase: { value: 0.5 },
    moonAlpha: { value: 0 },
    moonColor: { value: MOON_COLOR.clone() },
    starAlpha: { value: 0 },
    starTurn: { value: new THREE.Matrix3() },
  }
}

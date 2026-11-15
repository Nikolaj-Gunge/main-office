import { hash2, smoothstep, valueNoise } from './noise.ts'

/**
 * Deadwood's weather. The server picks a seed when the game starts; from then on the weather is
 * a pure function of the seed and the weather clock (seconds since the start, sleeping included),
 * so the server, every client and the tests all agree on it — down to when lightning strikes —
 * from two numbers (SurvivalShared.weather). Integer hashing and polynomials only (noise.ts):
 * different JS engines get the same answers.
 *
 * Underneath are two slow curves: how wet the sky is (clear → overcast → drizzle → rain → storm,
 * always passing through the steps in between) and how misty (fog, which the rain clears away).
 * Spells last several minutes and ease into each other. Now and then (rarely) a cold spell
 * comes through: whatever falls from the sky then falls as snow.
 */

export const WEATHER_KINDS = [
  'clear',
  'overcast',
  'fog',
  'drizzle',
  'rain',
  'storm',
  'snow',
] as const
export type WeatherKind = (typeof WEATHER_KINDS)[number]

/** What the weather is doing at one moment. Every channel runs 0–1. */
export interface Weather {
  /** The kind that dominates right now (for the HUD and for talking about it). */
  kind: WeatherKind
  /** Cloud cover: greys the day, darkens the night. */
  cloud: number
  /** How hard it rains (drizzle is up to about 0.35). */
  rain: number
  /** Ground mist and fog banks. */
  fog: number
  /** Thunderstorm: lightning, gales. */
  storm: number
  /** How windy, on top of the usual breeze. */
  wind: number
  /** How hard it snows (a rare cold spell turns the rain to snow). */
  snow: number
}

/** What everybody is told: enough to work out the rest (see weatherAt). */
export interface WeatherShared {
  seed: number
  /** The weather clock (s) when this was sent; clients run it on themselves. */
  clock: number
  kind: WeatherKind
  /** Held at this kind (an admin, or a test), whatever the seed says. */
  pin?: WeatherKind
  /**
   * When the weather was held, and at what (weather clock, s): the latest few, the one going on
   * now without a `to`. What builds up slowly (floods, snow on the ground) looks back over these.
   */
  holds?: WeatherHold[]
}

/** A stretch of the weather clock the weather was held at one kind. */
export interface WeatherHold {
  kind: WeatherKind
  from: number
  to?: number
}

/** Each kind at its most typical: what a pinned weather holds at. */
export const WEATHER_PRESETS: Record<WeatherKind, Weather> = {
  clear: { kind: 'clear', cloud: 0, rain: 0, fog: 0, storm: 0, wind: 0, snow: 0 },
  overcast: { kind: 'overcast', cloud: 1, rain: 0, fog: 0, storm: 0, wind: 0.18, snow: 0 },
  fog: { kind: 'fog', cloud: 0.6, rain: 0, fog: 1, storm: 0, wind: 0.05, snow: 0 },
  drizzle: { kind: 'drizzle', cloud: 1, rain: 0.25, fog: 0.1, storm: 0, wind: 0.26, snow: 0 },
  rain: { kind: 'rain', cloud: 1, rain: 0.65, fog: 0, storm: 0, wind: 0.4, snow: 0 },
  storm: { kind: 'storm', cloud: 1, rain: 1, fog: 0, storm: 1, wind: 1, snow: 0 },
  snow: { kind: 'snow', cloud: 1, rain: 0, fog: 0.1, storm: 0, wind: 0.3, snow: 0.8 },
}

/** Seconds per step of the wet and misty curves: spells last a few of these. */
export const WEATHER_STEP = 420
const FOG_STEP = 600

// Where along the wet curve each kind begins (tuned so clear and overcast spells are the
// commonest, storms the rarest: see weather.test.ts).
const OVERCAST = 0.46
const DRIZZLE = 0.6
const RAIN = 0.68
const STORM = 0.76
const STORM_FULL = 0.94

/** How wet the sky is at `seconds`, 0–1: two octaves of slow noise. */
function wetness(seed: number, seconds: number): number {
  const s = seconds / WEATHER_STEP
  const n = valueNoise(s, 0, seed) * 0.8 + valueNoise(s * 1.7 + 17, 0, seed + 1) * 0.2
  return 0.5 + 0.5 * n
}

function mistiness(seed: number, seconds: number): number {
  return 0.5 + 0.5 * valueNoise(seconds / FOG_STEP + 5, 0, seed + 2)
}

/** Seconds per step of the cold curve: cold spells are long and rare. */
const COLD_STEP = 1500
// Where along the cold curve the snow begins, and where everything falling is snow.
const COLD = 0.78
const COLD_FULL = 0.87

/** How cold the air is at `seconds`, 0–1 (only the far top of it snows). */
function coldness(seed: number, seconds: number): number {
  return 0.5 + 0.5 * valueNoise(seconds / COLD_STEP + 11, 0, seed + 3)
}

/**
 * The weather at `seconds` on the weather clock of a game with this seed (or, pinned, the
 * preset of that kind).
 */
export function weatherAt(seed: number, seconds: number, pin?: WeatherKind): Weather {
  if (pin) return WEATHER_PRESETS[pin]
  const wet = wetness(seed, seconds)
  const cloud = smoothstep(OVERCAST - 0.14, DRIZZLE + 0.02, wet)
  const wetRain = smoothstep(DRIZZLE - 0.02, STORM_FULL, wet)
  const wetStorm = smoothstep(STORM - 0.04, STORM_FULL, wet)
  // A cold spell: the rain comes down as snow (and a grey sky lets a little fall too).
  const chill = smoothstep(COLD, COLD_FULL, coldness(seed, seconds))
  const snow = chill * Math.max(wetRain, cloud * 0.35)
  const rain = wetRain * (1 - chill)
  const storm = wetStorm * (1 - chill)
  // Mist hangs about when it is grey but dry; rain washes it out.
  const fog =
    smoothstep(0.58, 0.84, mistiness(seed, seconds)) *
    (1 - smoothstep(DRIZZLE - 0.14, RAIN + 0.06, wet))
  const wind = Math.min(1, cloud * 0.18 + rain * 0.3 + storm * 0.6 + snow * 0.3)
  const kind: WeatherKind =
    snow >= 0.2
      ? 'snow'
      : wet >= STORM
        ? 'storm'
        : wet >= RAIN
          ? 'rain'
          : wet >= DRIZZLE
            ? 'drizzle'
            : fog >= 0.5
              ? 'fog'
              : wet >= OVERCAST
                ? 'overcast'
                : 'clear'
  return { kind, cloud, rain, fog, storm, wind, snow }
}

/** How strongly each kind is present (0–1 each): what the transitions blend between. */
export function weatherMix(w: Weather): Record<WeatherKind, number> {
  const drizzle = Math.min(1, w.rain / 0.3) * (1 - smoothstep(0.3, 0.5, w.rain))
  const raining = smoothstep(0.25, 0.5, w.rain) * (1 - w.storm)
  return {
    clear: (1 - w.cloud) * (1 - w.fog),
    overcast: w.cloud * (1 - Math.min(1, w.rain * 3)) * (1 - w.fog) * (1 - w.snow),
    fog: w.fog,
    drizzle,
    rain: raining,
    storm: w.storm,
    snow: w.snow,
  }
}

/** A lightning strike: when, how far away and which way (from wherever you stand). */
export interface Strike {
  /** On the weather clock (s). */
  at: number
  /** Metres from the listener (the thunder comes this / 343 s later). */
  distance: number
  /** Radians, the direction it is in (0 = +x). */
  bearing: number
  /** 0–1: bolts close by are brighter. */
  power: number
}

/** Strikes per second at the height of a storm. */
const STRIKE_RATE = 0.09
/** How long a flash lasts (s). */
export const FLASH_SECONDS = 0.7

/** The strike in second `s` of the clock, if there is one. */
function strikeIn(seed: number, s: number, pin?: WeatherKind): Strike | null {
  const storm = weatherAt(seed, s, pin).storm
  if (storm <= 0 || hash2(s, 71, seed) >= storm * STRIKE_RATE) return null
  const far = hash2(s, 73, seed)
  const distance = 120 + far * far * 2600
  return {
    at: s + hash2(s, 72, seed) * 0.8,
    distance,
    bearing: hash2(s, 74, seed) * Math.PI * 2,
    power: 1 - smoothstep(150, 2200, distance) * 0.75,
  }
}

/** The strikes between two times on the clock (from exclusive, to inclusive), oldest first. */
export function strikesBetween(
  seed: number,
  from: number,
  to: number,
  pin?: WeatherKind,
): Strike[] {
  const out: Strike[] = []
  if (to <= from) return out
  // Never more than a minute back (a frame after a long pause, or a sleep).
  for (let s = Math.floor(Math.max(from, to - 60)); s <= Math.floor(to); s++) {
    const strike = strikeIn(seed, s, pin)
    if (strike && strike.at > from && strike.at <= to) out.push(strike)
  }
  return out
}

/**
 * How bright lightning is lighting the world at `seconds`, 0–1: a bright first stroke, a dimmer
 * second one a moment after, then dark again.
 */
export function flashAt(seed: number, seconds: number, pin?: WeatherKind): number {
  let flash = 0
  for (let s = Math.floor(seconds - FLASH_SECONDS); s <= Math.floor(seconds); s++) {
    const strike = strikeIn(seed, s, pin)
    if (!strike) continue
    const age = seconds - strike.at
    if (age < 0 || age > FLASH_SECONDS) continue
    const first = age < 0.12 ? 1 - age / 0.12 : 0
    const second = age > 0.18 && age < 0.45 ? 0.7 * (1 - (age - 0.18) / 0.27) : 0
    const glow = 0.25 * (1 - age / FLASH_SECONDS)
    flash = Math.max(flash, Math.min(1, (first + second + glow) * strike.power))
  }
  return flash
}

/**
 * How far noise carries in this weather (a share of what it would): rain on the leaves drowns
 * out footsteps; a gunshot still carries, if not as far.
 */
export function hearingScale(w: Weather, loud = false): number {
  const mask = w.rain * 0.45 + w.storm * 0.15 + w.wind * 0.05
  return 1 - mask * (loud ? 0.45 : 1)
}

/**
 * How far the dead see in this weather (a share of what they would): fog and rain close in, a
 * lightning flash lights everything up for a moment.
 */
export function sightScale(w: Weather, flash: number): number {
  return (1 - w.fog * 0.35) * (1 - w.rain * 0.15) * (1 - w.snow * 0.15) * (1 + flash * 1.4)
}

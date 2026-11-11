/**
 * Distance rules for sound, as pure functions (tested in mixing.test.ts).
 *
 * Real sound pressure falls with 1/distance; games usually fall a bit faster so the nearest
 * sources clearly dominate. Everything also gets duller with distance (air absorbs highs).
 */

const SPEED_OF_SOUND = 343

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Volume multiplier at `distance`: full inside `ref` metres, then (ref/d)^1.5, smoothly faded to
 * silence over the last 25 % before `range`.
 */
export function falloff(distance: number, ref: number, range: number): number {
  if (distance >= range) return 0
  const d = Math.max(distance, ref)
  const curve = (ref / d) ** 1.5
  const fadeStart = range * 0.75
  const fade = distance <= fadeStart ? 1 : 1 - (distance - fadeStart) / (range - fadeStart)
  return curve * clamp01(fade)
}

/** Low-pass cutoff (Hz) for a sound `distance` metres away. */
export function distanceLowpass(distance: number): number {
  return distance < 1 ? 20000 : Math.max(900, 16000 * Math.exp(-distance / 30))
}

export interface GunshotMix {
  /** Overall volume (before the per-layer levels). */
  volume: number
  close: number
  body: number
  tail: number
  /** Seconds before the sound arrives. */
  delay: number
  lowpass: number
}

/** Own gun (no position) is quieter than it would be physically — it's right next to your ear. */
const OWN_GUN_VOLUME = 0.42
const REMOTE_GUN_VOLUME = 0.6

/**
 * Gunshot mix by distance: up close the mechanical crack and punch dominate; far away mostly the
 * echo, dull and late. Gunshots carry much further than footsteps (gentler curve).
 */
export function gunshotMix(distance: number | null): GunshotMix {
  if (distance === null) {
    return { volume: OWN_GUN_VOLUME, close: 1, body: 1, tail: 0.35, delay: 0, lowpass: 20000 }
  }
  const d = distance
  return {
    volume: REMOTE_GUN_VOLUME / (1 + d / 20),
    close: clamp01(1 - (d - 3) / 25),
    body: Math.max(0.15, clamp01(1 - d / 90)),
    tail: 0.35 + 0.65 * clamp01(d / 35),
    delay: d / SPEED_OF_SOUND,
    lowpass: distanceLowpass(d),
  }
}

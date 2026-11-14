import { heightAt, ITEMS, Surface, type SurvivalDef, surfaceAt } from '@office-fps/shared'

/**
 * Small pieces of "game feel" tuning kept apart from the classes that use them, so they can be
 * tested: how far a rumble carries, what the ground sounds like, how long a blow holds the frame.
 */

/** The user's "reduce motion" system setting (false where there's no browser). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Trauma from something `distance` m away that would give `amount` right on top of you: falls off
 * with the square of the distance, nothing beyond `radius`.
 */
export function traumaAt(amount: number, distance: number, radius: number): number {
  const k = Math.max(0, 1 - distance / radius)
  return amount * k * k
}

/** Something big happened somewhere: shake the view of anyone close enough. Set by main.ts. */
let rumbleSink:
  | ((at: { x: number; y: number; z: number }, amount: number, radius: number) => void)
  | null = null

export function setRumbleSink(sink: typeof rumbleSink): void {
  rumbleSink = sink
}

/** A heli passing low, a crate slamming down, a car crash: shakes your view if you're near. */
export function rumble(
  at: { x: number; y: number; z: number },
  amount: number,
  radius: number,
): void {
  rumbleSink?.(at, amount, radius)
}

/**
 * Blow-landed freeze (hit-stop), from how hard the weapon jolts the view (combat.ts FEEL.shake,
 * 0.08 knife … 0.8 sledge): 40 ms for a knife up to 80 ms for the heaviest.
 */
export function hitStopSeconds(shake: number): number {
  return 0.04 + 0.04 * Math.min(1, Math.max(0, (shake - 0.08) / 0.72))
}

/** How many spent casings may lie about at once, by automatic-quality step (0 = finest). */
export function casingCap(qualityBias: number): number {
  return qualityBias <= 0 ? 48 : qualityBias === 1 ? 24 : 12
}

/** Extra field of view (degrees) at full sprint. */
export const SPRINT_FOV_KICK = 5

/** Smoothed 0–1 "how much we're sprinting", for the FOV kick (eases in, eases out a bit faster). */
export class SprintKick {
  value = 0
  update(dt: number, sprinting: boolean): number {
    const target = sprinting ? 1 : 0
    const rate = sprinting ? 4 : 6
    this.value += (target - this.value) * (1 - Math.exp(-rate * dt))
    if (Math.abs(this.value - target) < 1e-3) this.value = target
    return this.value
  }
}

export type StepSurface = 'floor' | 'leaves' | 'grass' | 'dirt' | 'sand' | 'rock'

/**
 * What's underfoot: a floor (cabins, porches, the office) when the feet are clearly above the
 * terrain or there is no terrain; otherwise the forest floor's own surface.
 */
export function stepSurface(
  terrain: SurvivalDef['terrain'] | null | undefined,
  x: number,
  y: number,
  z: number,
): StepSurface {
  if (!terrain) return 'floor'
  if (y - heightAt(terrain, x, z) > 0.25) return 'floor'
  switch (surfaceAt(terrain, x, z)) {
    case Surface.Meadow:
      return 'grass'
    case Surface.Dirt:
      return 'dirt'
    case Surface.Sand:
      return 'sand'
    case Surface.Rock:
      return 'rock'
    default:
      return 'leaves'
  }
}

/** The one footstep sound, coloured per surface: pitch, loudness and how dull it is. */
export function footstepTone(surface: StepSurface): {
  rate: number
  volume: number
  lowpass: number
} {
  switch (surface) {
    case 'floor': // boards: a lower, hollow knock
      return { rate: 0.82, volume: 1.1, lowpass: 20000 }
    case 'leaves': // soft and crackly
      return { rate: 1.08, volume: 0.8, lowpass: 5200 }
    case 'grass': // a hush
      return { rate: 0.95, volume: 0.6, lowpass: 2600 }
    case 'dirt':
      return { rate: 0.86, volume: 0.85, lowpass: 3800 }
    case 'sand':
      return { rate: 0.78, volume: 0.7, lowpass: 1800 }
    case 'rock': // bright and hard
      return { rate: 1.2, volume: 1, lowpass: 20000 }
  }
}

/**
 * Pickup chime pitch from a loot notice ("+ $40", "+ Rifle ×2"): the more it's worth, the lower
 * and fuller it lands (cheap things tick, good things thunk). 1 = an ordinary find.
 */
export function pickupPitch(text: string): number {
  const cash = /\$\s*(\d+)/.exec(text)
  let value: number
  if (cash) value = Number(cash[1])
  else {
    const name = text
      .replace(/^\+\s*/, '')
      .replace(/\s*×\s*\d+$/, '')
      .trim()
    const def = Object.values(ITEMS).find((d) => d.name === name)
    // Unknown, or priceless (quest pieces have no trade value): an ordinary find.
    if (!def || def.value <= 0) return 1
    const count = Number(/×\s*(\d+)$/.exec(text)?.[1] ?? 1)
    value = def.value * count
  }
  // ~$5 → 1.2, ~$50 → 1.0, ~$500+ → 0.8 (log scale).
  const t = Math.log10(Math.max(1, value))
  return Math.max(0.78, Math.min(1.22, 1.2 - (t - 0.7) * 0.2))
}

/** A flinch over time (ms since the hit): snaps in over 40 ms, dies away over ~200 ms. */
export function flinchCurve(ms: number): number {
  if (ms < 0) return 0
  if (ms < 40) return ms / 40
  const k = Math.exp(-(ms - 40) / 70)
  return k < 0.01 ? 0 : k
}

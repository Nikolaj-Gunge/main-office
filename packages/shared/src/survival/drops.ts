// Supply drops: once the radio works, a helicopter now and then comes over the forest and
// drops a crate on a parachute. Shared so the server and every client fly the same helicopter.

/** A supply drop as everybody is told about it (SurvivalShared.drops). */
export interface SupplyDrop {
  id: number
  /** Where the crate comes down (on the ground). */
  x: number
  y: number
  z: number
  /** The helicopter's heading over the drop point (radians, atan2(dz, dx) of its flight). */
  heading: number
  /** Seconds since the helicopter set out, when this was sent. */
  age: number
  /** The crate is on the ground (its loot is out and the flare is burning). */
  landed: boolean
  /** Somebody has taken something from it: no longer worth a marker. */
  opened: boolean
}

/** The helicopter flies this high over the drop point (m above its ground). */
export const HELI_ALT = 120
/** Its speed (m/s). */
export const HELI_SPEED = 40
/** Seconds from setting out to being over the drop point and letting the crate go. */
export const DROP_RELEASE = 18
/** Seconds the crate takes to come down on its parachute. */
export const DROP_FALL = 12
/** Seconds from setting out until the crate is on the ground. */
export const DROP_LAND = DROP_RELEASE + DROP_FALL
/** Seconds from setting out until the helicopter has gone (out of sight and hearing). */
export const HELI_GONE = DROP_RELEASE + 22

/**
 * Seconds between drops at this point in the story, or null while there are none yet. The
 * radio on the tower brings the first; later in the story they come more often.
 */
export function dropInterval(done: readonly string[]): number | null {
  if (done.includes('site7')) return 4 * 60
  if (done.includes('voss')) return 5.5 * 60
  if (done.includes('tower')) return 7 * 60
  return null
}

/** Where the helicopter is `t` s after setting out (it slows a little over the drop point). */
export function heliPos(
  drop: Pick<SupplyDrop, 'x' | 'y' | 'z' | 'heading'>,
  t: number,
): { x: number; y: number; z: number } {
  const along = heliAlong(t)
  // A little lower while it hovers over the drop.
  const dip = Math.exp(-(((t - DROP_RELEASE) / 4) ** 2)) * 12
  return {
    x: drop.x + Math.cos(drop.heading) * along,
    y: drop.y + HELI_ALT - dip,
    z: drop.z + Math.sin(drop.heading) * along,
  }
}

/**
 * How far along its flight past the drop point the helicopter is at `t` (m, negative before
 * it gets there): full speed in and out, slowing to a crawl right over the drop.
 */
export function heliAlong(t: number): number {
  const s = t - DROP_RELEASE
  // Speed is HELI_SPEED * (1 - 0.8 * exp(-(s/3)^2)); integrated in closed form (erf approx).
  return HELI_SPEED * (s - 0.8 * 3 * (Math.sqrt(Math.PI) / 2) * erf(s / 3))
}

/** Height of the crate above the drop point's ground `t` s after the helicopter set out. */
export function crateHeight(t: number): number {
  if (t <= DROP_RELEASE) return HELI_ALT - 14
  const k = Math.min(1, (t - DROP_RELEASE) / DROP_FALL)
  // Falls fast for a moment, then the chute opens and it floats down.
  const start = HELI_ALT - 14
  return Math.max(0, start * (1 - (0.15 * Math.min(1, k * 8) + 0.85 * k)))
}

/** The eight-point compass direction from `from` to `to` (x east, z south). */
export function compassWord(from: { x: number; z: number }, to: { x: number; z: number }): string {
  const deg = ((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI + 360) % 360
  const names = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ]
  return names[Math.round(deg / 45) % 8] as string
}

/** Abramowitz–Stegun 7.1.26 (good to ~1e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a)
  return sign * y
}

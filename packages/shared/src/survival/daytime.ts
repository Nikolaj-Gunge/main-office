/**
 * Deadwood's day: the clock runs 0–1 and round again (SurvivalShared.time). It starts in the
 * dark; dawn comes at DAWN, it is full day from DAY, dusk begins at DUSK and it is night again
 * by NIGHTFALL. Server and client read the same numbers: the dead, the light and the HUD agree.
 */

/** One whole day and night (s). */
export const DAY_SECONDS = 32 * 60
/** Where a new game's clock starts: early in the night. */
export const START_TIME = 0.05
export const DAWN = 0.4
export const DAY = 0.48
export const DUSK = 0.88
export const NIGHTFALL = 0.96

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk'

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** 0 at night … 1 in daylight, easing through dawn and dusk. */
export function daylight(t: number): number {
  const u = ((t % 1) + 1) % 1
  if (u < DAWN || u >= NIGHTFALL) return 0
  if (u < DAY) return smooth((u - DAWN) / (DAY - DAWN))
  if (u < DUSK) return 1
  return 1 - smooth((u - DUSK) / (NIGHTFALL - DUSK))
}

export function dayPhase(t: number): DayPhase {
  const u = ((t % 1) + 1) % 1
  if (u < DAWN || u >= NIGHTFALL) return 'night'
  if (u < DAY) return 'dawn'
  if (u < DUSK) return 'day'
  return 'dusk'
}

/**
 * How far the sun has crossed the sky, 0 (rising in the east, at dawn) … 1 (setting in the west,
 * at nightfall); outside that it is below the horizon.
 */
export function sunProgress(t: number): number {
  const u = ((t % 1) + 1) % 1
  return (u - DAWN) / (NIGHTFALL - DAWN)
}

/** Clock time to wake at after sleeping at `t`: the next dawn (or now, if it is already light). */
export function wakeTime(t: number): number {
  const u = ((t % 1) + 1) % 1
  if (u < DAWN) return DAWN
  if (u >= DUSK) return 1 + DAWN
  return u
}

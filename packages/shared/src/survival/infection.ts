/**
 * The bite: one claw that draws blood and you are infected. Twenty minutes later (real time,
 * counted by the server only while you are playing) you turn. Adrenaline winds the clock back
 * to the start; only the experimental cure stops it. These helpers say how far along someone is,
 * for the server's symptoms and the client's screen and HUD.
 */

/** Seconds from the bite to turning. */
export const INFECTION_SECONDS = 20 * 60

/**
 * How far along: 0 bitten (first five minutes), 1 feverish (heartbeat, coughing), 2 the shakes
 * (the colour drains, red at the edges), 3 turning (blurred, doubled, whispers, short of breath),
 * 4 the last minute (heavy red, their voices in your head, staggering).
 */
export type InfectionStage = 0 | 1 | 2 | 3 | 4

/** Stage for `left` seconds to go (null: not infected → -1). */
export function infectionStage(left: number | null): InfectionStage | -1 {
  if (left === null) return -1
  const gone = INFECTION_SECONDS - left
  if (left <= 60) return 4
  if (gone >= 15 * 60) return 3
  if (gone >= 10 * 60) return 2
  if (gone >= 5 * 60) return 1
  return 0
}

const WORDS = ['Bitten', 'Feverish', 'The shakes', 'Turning', 'Turning'] as const

/** The word next to INFECTED on the HUD ("" when not infected). */
export function infectionWord(left: number | null): string {
  const stage = infectionStage(left)
  return stage === -1 ? '' : WORDS[stage]
}

/** Roughly how long is left, the way the backpack screen says it (never to the second). */
export function infectionLeftText(left: number | null): string {
  if (left === null) return ''
  if (left <= 60) return 'Any moment now.'
  if (left <= 3 * 60) return 'A few minutes left.'
  const minutes = Math.round(left / 60 / 5) * 5
  return minutes >= 20 ? 'About 20 minutes left.' : `About ${Math.max(5, minutes)} minutes left.`
}

/**
 * How strongly it shows on screen, 0–1: nothing for the first ten minutes, then the colour
 * drains and the edges redden (to 0.45 at fifteen), blur and double vision creep in (to 0.8 a
 * minute before), and the last minute goes all the way.
 */
export function infectionLevel(left: number | null): number {
  if (left === null) return 0
  const gone = INFECTION_SECONDS - Math.max(0, left)
  const ramp = (from: number, to: number) => Math.max(0, Math.min(1, (gone - from) / (to - from)))
  const last = INFECTION_SECONDS - 60
  return 0.45 * ramp(600, 900) + 0.35 * ramp(900, last) + 0.2 * ramp(last, INFECTION_SECONDS)
}

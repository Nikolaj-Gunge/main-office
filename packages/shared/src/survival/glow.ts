import { seeded } from './noise.ts'
import type { RotMood } from './rot.ts'
import type { WeatherKind } from './weather.ts'

/**
 * "The Glow": now and then, on a clear night, curtains of green light hang over the north of
 * the county. The server decides at dusk (so everybody sees the same sky) and says so in
 * SurvivalShared.rot.glow; the dead stop and stare up at it, and Wes mentions it on the radio.
 */

/** About one clear night in this many. */
export const GLOW_ODDS = 12

/** Whether night number `night` in a world seeded `seed` glows (seeded: the same on a replay). */
export function glowFor(seed: number, night: number, mood: RotMood, weather: WeatherKind): boolean {
  // Fog nights and anything but a clear sky hide it.
  if (mood === 'fog' || weather !== 'clear') return false
  return seeded(seed * 53 + night * 104729 + 911)() < 1 / GLOW_ODDS
}

/** What Wes says when it's up. */
export const GLOW_NEWS = [
  "Look north if you're out. Sky's gone green over the ridge. Haven't seen that since before. Don't stand gawping, though. They're looking too.",
  "There's light in the sky tonight, green, like curtains. The dead have gone quiet, just standing there staring up. I don't like it.",
]

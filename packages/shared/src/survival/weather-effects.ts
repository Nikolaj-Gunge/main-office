import { smoothstep } from './noise.ts'
import { heightAt } from './terrain.ts'
import type { Lake, Terrain } from './types.ts'
import { type Weather, type WeatherHold, type WeatherKind, weatherAt } from './weather.ts'

/**
 * What the weather leaves behind (ROADMAP 6.9): the things that build up slowly and go away
 * slowly — Miller's Lake swelling over its banks in a long storm, snow lying on the ground in a
 * cold spell. Like the weather itself these are pure functions of the seed, the weather clock
 * and the holds (an admin pinning the weather), so the server and every client agree on how high
 * the water is without anybody sending it.
 */

/** What the weather was and is: enough to look back over it (a WeatherShared fits). */
export interface WeatherPast {
  seed: number
  clock: number
  pin?: WeatherKind
  holds?: readonly WeatherHold[]
}

/** The kind the weather was held at, at `t` on the clock (if it was). */
export function heldAt(past: WeatherPast, t: number): WeatherKind | undefined {
  for (const h of past.holds ?? []) {
    if (t >= h.from && (h.to === undefined || t < h.to)) return h.kind
  }
  // An old server that only says it is pinned: pinned all along.
  return past.holds ? undefined : past.pin
}

/** Seconds between looks back at the weather. */
const LOOK_STEP = 20

/**
 * Something that follows a weather channel slowly: it climbs towards `pick(weather)` over `rise`
 * seconds (a time constant) and sinks over `fall`. Looks back far enough that where it started
 * no longer matters; the last part-step makes it run smoothly between looks.
 */
export function buildup(
  past: WeatherPast,
  pick: (w: Weather) => number,
  rise: number,
  fall: number,
): number {
  const span = Math.min(3600, fall * 5)
  const first = Math.max(0, Math.floor((past.clock - span) / LOOK_STEP) * LOOK_STEP)
  let level = 0
  let t = first
  const at = (s: number) => pick(weatherAt(past.seed, s, heldAt(past, s)))
  const move = (target: number, dt: number) => {
    const tau = target > level ? rise : fall
    level += (target - level) * (1 - Math.exp(-dt / tau))
  }
  for (; t + LOOK_STEP <= past.clock; t += LOOK_STEP) move(at(t), LOOK_STEP)
  if (past.clock > t) move(at(t), past.clock - t)
  return Math.max(0, Math.min(1, level))
}

// --- The flood -------------------------------------------------------------------------------

/** How much higher the lake stands at the height of a flood (m). */
export const FLOOD_RISE = 1.3
/** How far past its old shore the swollen lake can reach (m, from the lake's rim). */
export const FLOOD_REACH = 50
/** The fishing jetty's deck stands this far over the lake on a calm day (places-wild.ts). */
export const JETTY_ABOVE = 0.55
/** Water this deep over your feet (m) in a flood takes you off them. */
export const SWEEP_DEPTH = 0.4
/** The current at its strongest (m/s). */
export const CURRENT = 2.4
/** Water this deep (m) over where a car stands drowns its engine. */
export const STALL_DEPTH = 0.55

/** What the sky is pouring into the lake: storms most, heavy rain a little. */
function inflow(w: Weather): number {
  return Math.min(1, w.storm + Math.max(0, w.rain - 0.55) * 0.6)
}

/**
 * How swollen the lakes are, 0–1: rises over a long storm (most of the way in ten minutes),
 * goes back down over a quarter of an hour or so after it.
 */
export function floodAt(past: WeatherPast): number {
  return buildup(past, inflow, 200, 420)
}

/** The water's surface on a lake this swollen. */
export function lakeLevel(lake: Lake, flood: number): number {
  return lake.y + flood * FLOOD_RISE
}

/** How far from its centre a lake's water may reach when this swollen (m). */
export function lakeReach(lake: Lake, flood: number): number {
  return lake.r + 28 + smoothstep(0, 0.4, flood) * (FLOOD_REACH - 28)
}

/** The ground and the lakes, as far as the water goes. */
export interface WaterWorld {
  terrain: Terrain
  lakes: readonly Lake[]
}

/**
 * The lake whose water stands at (x, z) at this flood, and how deep it is over `y` (feet; or
 * over the ground with no `y`). Null where there's no water, or `y` is above it.
 */
export function waterAt(
  world: WaterWorld,
  x: number,
  z: number,
  flood: number,
  y?: number,
): { lake: Lake; level: number; depth: number } | null {
  for (const lake of world.lakes) {
    const d = Math.hypot(x - lake.x, z - lake.z)
    if (d > lakeReach(lake, flood)) continue
    const level = lakeLevel(lake, flood)
    const ground = heightAt(world.terrain, x, z)
    if (ground >= level) continue
    const depth = level - (y ?? ground)
    if (depth <= -0.1) continue
    return { lake, level, depth }
  }
  return null
}

/** Is the fishing jetty at Miller's Lake still above the water (or not so far under it)? */
export function jettyPassable(flood: number): boolean {
  return flood * FLOOD_RISE - JETTY_ABOVE < SWEEP_DEPTH
}

/** How hard the flood pulls, 0 (no current) … 1. */
export function currentStrength(flood: number): number {
  return smoothstep(0.45, 0.85, flood)
}

/**
 * Where the lake spills out when it floods: the lowest way out of its bowl (radians, 0 = +x).
 * The current swirls round the lake and drifts that way.
 */
export function lakeOutlet(terrain: Terrain, lake: Lake): number {
  let best = 0
  let low = Number.POSITIVE_INFINITY
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2
    const h = heightAt(
      terrain,
      lake.x + Math.cos(a) * (lake.r + 40),
      lake.z + Math.sin(a) * (lake.r + 40),
    )
    if (h < low) {
      low = h
      best = a
    }
  }
  return best
}

/**
 * The flood's push on somebody standing at (x, z) with water `depth` over their feet (m/s, x and
 * z), or null where it doesn't take them: round the lake, drifting to the outlet.
 */
export function currentAt(
  lake: Lake,
  outlet: number,
  x: number,
  z: number,
  depth: number,
  flood: number,
): { x: number; z: number } | null {
  const pull = currentStrength(flood) * smoothstep(SWEEP_DEPTH * 0.6, SWEEP_DEPTH * 1.6, depth)
  if (pull <= 0) return null
  const dx = x - lake.x
  const dz = z - lake.z
  const d = Math.max(1, Math.hypot(dx, dz))
  let fx = (-dz / d) * 0.8 + Math.cos(outlet) * 0.5
  let fz = (dx / d) * 0.8 + Math.sin(outlet) * 0.5
  const n = Math.hypot(fx, fz) || 1
  fx /= n
  fz /= n
  return { x: fx * CURRENT * pull, z: fz * CURRENT * pull }
}

// --- Snow ------------------------------------------------------------------------------------

/** How much snow lies on the ground, 0–1: settles over a few minutes, thaws more slowly. */
export function snowCoverAt(past: WeatherPast): number {
  return buildup(past, (w) => Math.min(1, w.snow * 1.4), 150, 360)
}

/** Snow this deep (0–1) takes footprints. */
export const PRINTS_FROM = 0.2
/** How long a footprint lasts in the snow (s). */
export const PRINT_SECONDS = 120

import type { Road, SurvivalDef } from './types.ts'

/** A car left at the side of a road: where, which way it faces, and what it looks like. */
export interface CarSpot {
  x: number
  z: number
  yaw: number
  /** Paint and body (see the client's vehicle view). */
  look: number
  /** Unit vector along the road, for nudging the car along it until it fits. */
  along: { x: number; z: number }
}

/**
 * The places a car was left (two in the bigger towns). Hollis' cabin has one: the first thing
 * you find can be a way to get about.
 */
const CAR_PLACES: [string, number][] = [
  ['start', 1],
  ['haven', 1],
  ['pinewatch', 2],
  ['millcreek', 1],
  ['ashford', 2],
  ['gas_north', 1],
  ['gas_south', 1],
  ['motel', 1],
  ['farm', 1],
  ['church', 1],
  ['sawmill', 1],
  ['checkpoint_east', 1],
]

/** Distance between two cars left at the same place (m, along the road). */
const SPACING = 14

/**
 * Where the cars are parked: at the roadside nearest each place in CAR_PLACES, facing along
 * the road, on the side the place is. The server nudges each along the road until it fits.
 */
export function carSpots(def: SurvivalDef): CarSpot[] {
  const spots: CarSpot[] = []
  for (const [key, count] of CAR_PLACES) {
    const poi = def.pois.find((p) => p.key === key)
    if (!poi) continue
    const near = nearestRoadPoint(def.roads, poi.x, poi.z)
    if (!near || near.distance > poi.r + 80) continue
    const { road, index } = near
    const line = road.line
    const a = line[Math.max(0, index - 1)]
    const b = line[Math.min(line.length - 1, index + 1)]
    const p = line[index]
    if (!a || !b || !p) continue
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const along = { x: (b.x - a.x) / length, z: (b.z - a.z) / length }
    // The side of the road the place is on (left of `along` is (along.z, −along.x)).
    const toPoi = (poi.x - p.x) * along.z - (poi.z - p.z) * along.x
    const side = toPoi >= 0 ? 1 : -1
    const off = road.width / 2 + 1.5
    for (let i = 0; i < count; i++) {
      const shift = i * SPACING
      const x = p.x + along.x * shift + along.z * side * off
      const z = p.z + along.z * shift - along.x * side * off
      // Facing along the road (forward is (−sin yaw, −cos yaw)); every other one the other way.
      const flip = (spots.length + i) % 3 === 2 ? -1 : 1
      spots.push({
        x,
        z,
        yaw: Math.atan2(-along.x * flip, -along.z * flip),
        look: spots.length,
        along,
      })
    }
  }
  return spots
}

function nearestRoadPoint(
  roads: readonly Road[],
  x: number,
  z: number,
): { road: Road; index: number; distance: number } | null {
  let best: { road: Road; index: number; distance: number } | null = null
  for (const road of roads) {
    road.line.forEach((p, index) => {
      const distance = Math.hypot(p.x - x, p.z - z)
      if (!best || distance < best.distance) best = { road, index, distance }
    })
  }
  return best
}

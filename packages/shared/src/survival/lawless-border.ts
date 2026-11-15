import type { MapBox } from '../maps/types.ts'
import { hash2 } from './noise.ts'
import { LAWLESS_RADIUS, lawlessBorder, lawlessCentre } from './pvp.ts'
import type { RoadSign } from './road-dressing.ts'
import { chunkOf, chunkProps, PropKind } from './terrain.ts'
import type { Poi, Road, Terrain } from './types.ts'

/**
 * Marks the edge of the Lawless ground (pvp.ts) so nobody walks in by mistake: a plywood
 * warning sign on two posts every so often, facing the way people come in from, and a band of
 * red paint round the trees along the line, the way the army marked it before it gave up.
 */

/** A sign every this far along the border (m). */
const SIGN_SPACING = 38
/** Trees this close to the line (m) get a red band. */
const PAINT_BAND = 4
/** Signs keep this far from the middle of a road (m), so cars get by. */
const ROAD_CLEAR = 7

const SIGN_TEXT: string[][] = [
  ['LAWLESS GROUND', 'ANYONE CAN SHOOT YOU'],
  ['NO LAW PAST HERE', 'TURN BACK'],
  ['LAWLESS GROUND', 'YOU WERE WARNED'],
]

function nearRoad(roads: readonly Road[], x: number, z: number): boolean {
  for (const road of roads) {
    const reach = road.width / 2 + ROAD_CLEAR
    for (const p of road.line) {
      if (Math.abs(p.x - x) < reach && Math.abs(p.z - z) < reach) return true
    }
  }
  return false
}

export function markLawless(
  boxes: MapBox[],
  w: {
    pois: readonly Poi[]
    roads: readonly Road[]
    terrain: Terrain
    seed: number
    groundAt(x: number, z: number): number
  },
): RoadSign[] {
  const signs: RoadSign[] = []
  const centre = lawlessCentre(w.pois)
  if (!centre) return signs
  lawlessBorder(w.pois, SIGN_SPACING).forEach((at, i) => {
    // Just outside the line, so it is read on the way in.
    let x = at.x + at.out[0] * 1.5
    let z = at.z + at.out[1] * 1.5
    if (nearRoad(w.roads, x, z)) {
      // A road crosses here: the sign stands beside it instead, where every driver sees it.
      const side = [-at.out[1], at.out[0]]
      const shifted = [1, -1]
        .map((k) => [x + (side[0] as number) * k * 9, z + (side[1] as number) * k * 9])
        .find(([sx, sz]) => !nearRoad(w.roads, sx as number, sz as number))
      if (!shifted) return
      x = shifted[0] as number
      z = shifted[1] as number
    }
    const y = w.groundAt(x, z)
    const facing: [number, number] = [at.out[0], at.out[1]]
    const width = 1.5
    const postH = 1.1
    // Two posts, either side of the face (along the border).
    for (const k of [-1, 1]) {
      const px = x - at.out[1] * k * (width / 2 - 0.15) - at.out[0] * 0.06
      const pz = z + at.out[0] * k * (width / 2 - 0.15) - at.out[1] * 0.06
      boxes.push({
        center: [px, y + (postH + 0.9) / 2, pz],
        size: [0.1, postH + 0.9, 0.1],
        material: 'wood',
      })
    }
    const askew = (hash2(i, 7, w.seed) - 0.5) * 0.12
    signs.push({
      kind: 'lawless',
      pos: [x + at.out[0] * 0.02, y + postH + 0.4, z + at.out[1] * 0.02],
      facing,
      w: width,
      h: 0.8,
      lines: SIGN_TEXT[i % SIGN_TEXT.length] as string[],
      askew,
    })
  })

  // Red paint round the trees along the line.
  const seen = new Set<string>()
  for (const at of lawlessBorder(w.pois, 20)) {
    const [cx, cz] = chunkOf(at.x, at.z)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx},${cz + dz}`
        if (seen.has(key)) continue
        seen.add(key)
        for (const p of chunkProps(w.terrain, w.seed, cx + dx, cz + dz)) {
          if (p.kind !== PropKind.Pine && p.kind !== PropKind.Birch) continue
          const d = Math.hypot(p.x - centre.x, p.z - centre.z)
          if (Math.abs(d - LAWLESS_RADIUS) > PAINT_BAND) continue
          const trunk = (p.kind === PropKind.Pine ? 0.36 : 0.2) * p.scale + 0.05
          const turn = p.turn * Math.PI * 2
          boxes.push({
            center: [p.x, p.y + 1.25, p.z],
            size: [trunk, 0.32, trunk],
            rotation: [0, turn, 0],
            material: 'redpaint',
            collide: false,
          })
        }
      }
    }
  }
  return signs
}

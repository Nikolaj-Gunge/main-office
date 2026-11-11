import { type PhysicsWorld, PLAYER_QUERY_GROUPS, RAPIER } from '../physics/world.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { PlayerBody } from '../sim/player.ts'
import type { MapDef, Vec3 } from './types.ts'

/** Extra room required around a spawn spot (m), so nobody spawns hugging a wall. */
const CLEARANCE_RADIUS = 0.55

/**
 * Every valid random-spawn spot in the map: a grid over `map.spawnArea`, on each floor height
 * the fixed spawns use. A spot counts when the floor right below it is flat and exactly at that
 * floor's height (so never on furniture, stairs or ramps) and a slightly fat capsule fits.
 * Run once when the server starts.
 */
export function findSpawnPoints(map: MapDef, physics: PhysicsWorld, spacing = 1.5): Vec3[] {
  const area = map.spawnArea
  if (!area) return map.spawns.map((s) => s.pos)
  const floors = [...new Set(map.spawns.map((s) => s.pos[1]))]
  const probe = new PlayerBody(physics, { ...DEFAULT_MOVEMENT, radius: CLEARANCE_RADIUS })
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  const points: Vec3[] = []
  try {
    for (const y of floors) {
      for (let x = area.min[0] + spacing / 2; x < area.max[0]; x += spacing) {
        for (let z = area.min[1] + spacing / 2; z < area.max[1]; z += spacing) {
          const top = y + 1.9
          ray.origin = { x, y: top, z }
          const hit = physics.world.castRayAndGetNormal(
            ray,
            2.2,
            true,
            undefined,
            PLAYER_QUERY_GROUPS,
            probe.collider,
          )
          if (!hit || hit.normal.y < 0.95) continue
          if (Math.abs(top - hit.timeOfImpact - y) > 0.03) continue
          if (!probe.fits({ x, y, z }, DEFAULT_MOVEMENT.standHeight)) continue
          points.push([x, y, z])
        }
      }
    }
  } finally {
    probe.free()
  }
  return points
}

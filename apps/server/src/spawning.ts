import {
  type MapSpawn,
  type PhysicsWorld,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  type Vec3,
} from '@office-fps/shared'

/** Never spawn closer than this to a living enemy (m), if any spot allows it. */
export const MIN_ENEMY_DISTANCE = 10
const EYE = 1.6
/** Candidates checked per spawn (random sample keeps it fast and unpredictable). */
const SAMPLE = 48

export interface Enemy {
  x: number
  y: number
  z: number
}

/**
 * Random spawns anywhere on the map, but never in an enemy's face: a spot must be at least
 * MIN_ENEMY_DISTANCE from every living enemy and out of their line of sight (glass doesn't
 * hide you). Falls back to the farthest spot when the map is too crowded for that.
 */
export class SpawnPicker {
  private readonly points: Vec3[]
  private readonly physics: PhysicsWorld
  private readonly random: () => number
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

  constructor(points: Vec3[], physics: PhysicsWorld, random: () => number = Math.random) {
    if (points.length === 0) throw new Error('No spawn points')
    this.points = points
    this.physics = physics
    this.random = random
  }

  get count(): number {
    return this.points.length
  }

  pick(enemies: Enemy[]): MapSpawn {
    let fallback: Vec3 | undefined
    let fallbackScore = Number.NEGATIVE_INFINITY
    for (let i = 0; i < SAMPLE; i++) {
      const p = this.points[Math.floor(this.random() * this.points.length)] as Vec3
      let nearest = Number.POSITIVE_INFINITY
      let seen = false
      for (const e of enemies) {
        nearest = Math.min(nearest, Math.hypot(e.x - p[0], e.y - p[1], e.z - p[2]))
        if (!seen && this.canSee(e, p)) seen = true
      }
      if (!seen && nearest >= MIN_ENEMY_DISTANCE) return this.facing(p)
      // Hidden beats visible, then farther beats closer.
      const score = (seen ? 0 : 1000) + Math.min(nearest, 999)
      if (score > fallbackScore) {
        fallbackScore = score
        fallback = p
      }
    }
    return this.facing(fallback ?? (this.points[0] as Vec3))
  }

  /** Line of sight from an enemy's eyes to a spawn spot's head height. Glass doesn't block. */
  canSee(from: Enemy, to: Vec3): boolean {
    const o = { x: from.x, y: from.y + EYE, z: from.z }
    const d = { x: to[0] - o.x, y: to[1] + EYE - o.y, z: to[2] - o.z }
    const length = Math.hypot(d.x, d.y, d.z)
    if (length < 0.01) return true
    this.ray.origin = o
    this.ray.dir = { x: d.x / length, y: d.y / length, z: d.z / length }
    const seeThrough = this.physics.seeThrough
    const hit = this.physics.world.castRay(
      this.ray,
      length,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
      undefined,
      undefined,
      (collider) => !seeThrough.has(collider.handle),
    )
    return hit === null
  }

  /** Face the middle of the map so you don't spawn staring at a wall. */
  private facing(p: Vec3): MapSpawn {
    return { pos: p, yaw: Math.atan2(p[0], p[2]) }
  }
}

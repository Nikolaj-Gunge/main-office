import RAPIER from '@dimforge/rapier3d-compat'
import type { MapDef } from '../maps/types.ts'

export { RAPIER }

let ready: Promise<void> | null = null

/** Loads the Rapier WASM module. Safe to call many times; resolves once. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init()
  return ready
}

/**
 * Rapier interaction groups: high 16 bits = membership, low 16 bits = what it interacts with.
 * Players are only blocked by the map, never by each other: player-vs-player blocking would
 * mispredict constantly (you collide with where *you* see them, the server with where they are).
 */
export const GROUP_MAP = 0x0001
export const GROUP_PLAYER = 0x0002
export const MAP_COLLISION_GROUPS = (GROUP_MAP << 16) | 0xffff
export const PLAYER_COLLISION_GROUPS = (GROUP_PLAYER << 16) | GROUP_MAP
/** Scene-query filter for player movement: hits the map only. */
export const PLAYER_QUERY_GROUPS = (GROUP_PLAYER << 16) | GROUP_MAP

export interface PhysicsWorld {
  world: RAPIER.World
  /** Static map colliders (boxes with collide !== false), in map order. */
  mapColliders: RAPIER.Collider[]
  /** Handles of colliders you can see through (glass): they block bullets, not line of sight. */
  seeThrough: Set<number>
  /** Colliders of each gate (co-op maps), removed while the gate is open. */
  gates: Map<number, RAPIER.Collider[]>
}

/**
 * Builds a query-only Rapier world from a map: static cuboids, no gravity, no dynamic bodies.
 * Movement is fully kinematic (see sim/player.ts); Rapier only answers "where can I go?".
 */
export function createPhysicsWorld(map: MapDef): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const seeThrough = new Set<number>()
  const gates = new Map<number, RAPIER.Collider[]>()
  const mapColliders = map.boxes
    .filter((box) => box.collide !== false)
    .map((box) => {
      const [hx, hy, hz] = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2]
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(...box.center)
        .setCollisionGroups(MAP_COLLISION_GROUPS)
      if (box.rotation) desc.setRotation(eulerToQuaternion(...box.rotation))
      const collider = world.createCollider(desc)
      if (box.material === 'glass') seeThrough.add(collider.handle)
      if (box.gate !== undefined) gates.set(box.gate, [...(gates.get(box.gate) ?? []), collider])
      return collider
    })
  // One step builds the broad phase so scene queries see the colliders.
  world.step()
  return { world, mapColliders, seeThrough, gates }
}

/**
 * Opens (removes) or shuts every gate: `open(id)` says which. Server and client call this with
 * the same gate states, so prediction collides with exactly what the server does.
 */
export function setGates(physics: PhysicsWorld, open: (id: number) => boolean): void {
  let changed = false
  for (const [id, colliders] of physics.gates) {
    for (const collider of colliders) {
      const enabled = !open(id)
      if (collider.isEnabled() === enabled) continue
      collider.setEnabled(enabled)
      changed = true
    }
  }
  // One step refreshes the broad phase that scene queries use (there are no moving bodies).
  if (changed) physics.world.step()
}

/** Euler XYZ (radians, Three.js default order) → quaternion. */
export function eulerToQuaternion(x: number, y: number, z: number): RAPIER.Rotation {
  const c1 = Math.cos(x / 2)
  const c2 = Math.cos(y / 2)
  const c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2)
  const s2 = Math.sin(y / 2)
  const s3 = Math.sin(z / 2)
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  }
}

import RAPIER from '@dimforge/rapier3d-compat'
import type { MapDef } from '../maps/types.ts'
import { chunkOf, chunkProps, propSolid } from '../survival/terrain.ts'
import { CHUNK, CHUNKS, GRID, type SurvivalDef, WORLD_HALF, WORLD_SIZE } from '../survival/types.ts'

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
/**
 * Foliage (corn): blocks people, but zombies and bots push straight through it, and bullets and
 * sight pass through it (every query above filters on GROUP_MAP alone, so they never see it).
 */
export const GROUP_FOLIAGE = 0x0008
export const FOLIAGE_COLLISION_GROUPS = (GROUP_FOLIAGE << 16) | 0xffff
/** Movement filter for people (not zombies or bots): the map plus foliage. */
export const PERSON_QUERY_GROUPS = PLAYER_QUERY_GROUPS | GROUP_FOLIAGE

/** Materials that are foliage (see GROUP_FOLIAGE). */
export const FOLIAGE_MATERIALS: ReadonlySet<string> = new Set(['corn'])

export interface PhysicsWorld {
  world: RAPIER.World
  /** Static map colliders (boxes with collide !== false), in map order. */
  mapColliders: RAPIER.Collider[]
  /** Handles of colliders you can see through (glass): they block bullets, not line of sight. */
  seeThrough: Set<number>
  /** Colliders of each gate (co-op maps), removed while the gate is open. */
  gates: Map<number, RAPIER.Collider[]>
  /** Survival: the forest's trees and rocks, solid only around the players (see syncForest). */
  forest?: { def: SurvivalDef; chunks: Map<number, RAPIER.Collider[]> }
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
        .setCollisionGroups(
          FOLIAGE_MATERIALS.has(box.material) ? FOLIAGE_COLLISION_GROUPS : MAP_COLLISION_GROUPS,
        )
      if (box.rotation) desc.setRotation(eulerToQuaternion(...box.rotation))
      const collider = world.createCollider(desc)
      if (box.material === 'glass') seeThrough.add(collider.handle)
      if (box.gate !== undefined) gates.set(box.gate, [...(gates.get(box.gate) ?? []), collider])
      return collider
    })
  const physics: PhysicsWorld = { world, mapColliders, seeThrough, gates }
  if (map.survival) {
    // The ground, and walls around the edge of the world behind the rim of hills.
    const t = map.survival.terrain
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(GRID, GRID, t.heights, {
        x: WORLD_SIZE,
        y: 1,
        z: WORLD_SIZE,
      }).setCollisionGroups(MAP_COLLISION_GROUPS),
    )
    const edge = WORLD_HALF - 24
    for (const [x, z, hx, hz] of [
      [edge, 0, 1, WORLD_HALF],
      [-edge, 0, 1, WORLD_HALF],
      [0, edge, WORLD_HALF, 1],
      [0, -edge, WORLD_HALF, 1],
    ] as const) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 200, hz)
          .setTranslation(x, 100, z)
          .setCollisionGroups(MAP_COLLISION_GROUPS),
      )
    }
    physics.forest = { def: map.survival, chunks: new Map() }
  }
  // One step builds the broad phase so scene queries see the colliders.
  world.step()
  return physics
}

/** Trees are solid in chunks whose centre is within this of someone (m)… */
export const FOREST_RADIUS = 110
/** …and stay solid until that far away. */
const FOREST_KEEP = FOREST_RADIUS + CHUNK

/**
 * Survival: makes the forest solid around `centres` (the players) and lets go of chunks nobody
 * is near any more. Client and server call it with their own players; a chunk's trees are the
 * same everywhere. Returns true if anything changed.
 */
export function syncForest(
  physics: PhysicsWorld,
  centres: readonly { x: number; z: number }[],
): boolean {
  const forest = physics.forest
  if (!forest) return false
  const near = (cx: number, cz: number, radius: number) => {
    const x = (cx + 0.5) * CHUNK - WORLD_HALF
    const z = (cz + 0.5) * CHUNK - WORLD_HALF
    return centres.some((c) => Math.hypot(c.x - x, c.z - z) <= radius)
  }
  let changed = false
  for (const [key, colliders] of forest.chunks) {
    if (near(Math.floor(key / CHUNKS), key % CHUNKS, FOREST_KEEP)) continue
    for (const collider of colliders) physics.world.removeCollider(collider, false)
    forest.chunks.delete(key)
    changed = true
  }
  const reach = Math.ceil(FOREST_RADIUS / CHUNK)
  for (const c of centres) {
    const [ccx, ccz] = chunkOf(c.x, c.z)
    for (let cx = Math.max(0, ccx - reach); cx <= Math.min(CHUNKS - 1, ccx + reach); cx++) {
      for (let cz = Math.max(0, ccz - reach); cz <= Math.min(CHUNKS - 1, ccz + reach); cz++) {
        const key = cx * CHUNKS + cz
        if (forest.chunks.has(key) || !near(cx, cz, FOREST_RADIUS)) continue
        const colliders: RAPIER.Collider[] = []
        for (const prop of chunkProps(forest.def.terrain, forest.def.seed, cx, cz)) {
          const solid = propSolid(prop)
          if (!solid) continue
          colliders.push(
            physics.world.createCollider(
              RAPIER.ColliderDesc.cylinder(solid.height / 2 + 0.3, solid.radius)
                .setTranslation(prop.x, prop.y + solid.height / 2 - 0.3, prop.z)
                .setCollisionGroups(MAP_COLLISION_GROUPS),
            ),
          )
        }
        forest.chunks.set(key, colliders)
        changed = true
      }
    }
  }
  if (changed) physics.world.step()
  return changed
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

import RAPIER from '@dimforge/rapier3d-compat'
import { PIECES, type Piece, pieceBase, pieceBlocks, pieceYaw } from '../survival/building.ts'
import type { SurvivalDef } from '../survival/types.ts'
import { eulerToQuaternion, MAP_COLLISION_GROUPS, type PhysicsWorld } from './world.ts'

/**
 * The solid parts of built pieces (survival/building.ts) in a physics world. Kept beside the
 * world rather than in it: server and client call setBuilds with the same list, and only what
 * changed (a piece put up, taken down, a door opened) is rebuilt.
 */
interface Built {
  sig: string
  colliders: RAPIER.Collider[]
}

const builtIn = new WeakMap<PhysicsWorld, Map<number, Built>>()

const signature = (p: Piece) => `${p.kind}:${p.x}:${p.z}:${p.rot}:${p.open ? 1 : 0}`

/** Makes exactly these pieces solid. Returns true when anything changed. */
export function setBuilds(
  physics: PhysicsWorld,
  def: Pick<SurvivalDef, 'terrain'>,
  pieces: Iterable<Piece>,
): boolean {
  let built = builtIn.get(physics)
  if (!built) {
    built = new Map()
    builtIn.set(physics, built)
  }
  let changed = false
  const seen = new Set<number>()
  for (const p of pieces) {
    seen.add(p.id)
    const sig = signature(p)
    const had = built.get(p.id)
    if (had?.sig === sig) continue
    if (had) for (const c of had.colliders) physics.world.removeCollider(c, false)
    const base = pieceBase(def, p)
    const colliders = pieceBlocks(p, base).map((b) =>
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(...b.half)
          .setTranslation(...b.center)
          .setRotation(eulerToQuaternion(0, b.yaw, 0))
          .setCollisionGroups(MAP_COLLISION_GROUPS),
      ),
    )
    built.set(p.id, { sig, colliders })
    changed = true
  }
  for (const [id, b] of built) {
    if (seen.has(id)) continue
    for (const c of b.colliders) physics.world.removeCollider(c, false)
    built.delete(id)
    changed = true
  }
  if (changed) physics.world.step()
  return changed
}

/**
 * Is the map (a house, a fence, a tree near somebody) in the way of a piece standing on `base`?
 * Built pieces don't count (building.ts checks those itself, letting walls meet at corners).
 */
export function mapBlocks(
  physics: PhysicsWorld,
  p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>,
  base: number,
): boolean {
  const def = PIECES[p.kind]
  const mine = new Set<number>()
  for (const b of builtIn.get(physics)?.values() ?? [])
    for (const c of b.colliders) mine.add(c.handle)
  // From a little above the ground (the ground itself is left out) to the top.
  const lift = 0.3
  const shape = new RAPIER.Cuboid(
    Math.max(0.05, def.w / 2 - 0.05),
    Math.max(0.05, (def.h - lift) / 2),
    Math.max(0.05, def.d / 2 - 0.05),
  )
  const hit = physics.world.intersectionWithShape(
    { x: p.x, y: base + lift + (def.h - lift) / 2, z: p.z },
    eulerToQuaternion(0, pieceYaw(p.rot), 0),
    shape,
    undefined,
    undefined,
    physics.ground,
    undefined,
    (c) => !mine.has(c.handle),
  )
  return hit !== null
}

import RAPIER from '@dimforge/rapier3d-compat'
import { PROJECTS, type ProjectId } from '../survival/projects.ts'
import { heightAt } from '../survival/terrain.ts'
import type { SurvivalDef } from '../survival/types.ts'
import { MAP_COLLISION_GROUPS, type PhysicsWorld } from './world.ts'

/**
 * The solid parts of Haven's finished community projects (survival/projects.ts), so nobody walks
 * through the well or the outer wall. Simple boxes following what the client draws
 * (render/projects-view.ts); server and client both call setProjects with the projects as shared.
 */
export interface ProjectBlock {
  /** World centre and half extents (axis aligned). */
  center: [number, number, number]
  half: [number, number, number]
}

/** A box `w`×`h`×`d` standing on `y` at (x, z), as a block. */
const box = (w: number, h: number, d: number, x: number, y: number, z: number): ProjectBlock => ({
  center: [x, y + h / 2, z],
  half: [w / 2, h / 2, d / 2],
})

/** The solid boxes of one finished project, in world coordinates. */
export function projectBlocks(
  def: Pick<SurvivalDef, 'terrain' | 'pois'>,
  id: ProjectId,
): ProjectBlock[] {
  const haven = def.pois.find((p) => p.key === 'haven')
  const p = PROJECTS.find((q) => q.id === id)
  if (!haven || !p) return []
  const ax = haven.x + p.at[0]
  const az = haven.z + p.at[1]
  const ground = (x: number, z: number) => heightAt(def.terrain, x, z)
  const base = ground(ax, az)
  const at = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    box(w, h, d, ax + x, base + y, az + z)
  const out: ProjectBlock[] = []
  switch (id) {
    case 'watchtower':
      for (const x of [-1.3, 1.3])
        for (const z of [-1.3, 1.3]) out.push(at(0.26, 5.4, 0.26, x, 0, z))
      out.push(at(3.2, 0.16, 3.2, 0, 5.4, 0))
      break
    case 'well':
      for (const e of [-1, 1]) {
        out.push(at(1.9, 0.8, 0.32, 0, 0, e * 0.8))
        out.push(at(0.32, 0.8, 1.3, e * 0.8, 0, 0))
        out.push(at(0.16, 2.3, 0.16, e * 0.9, 0, 0))
      }
      break
    case 'wall':
      // The palisade either side of the gate road, in short runs that follow the ground.
      for (const side of [-1, 1])
        for (let x = 8; x < 22; x += 2) {
          const cx = ax + side * (x + 1)
          out.push(box(2.1, 3.3, 0.4, cx, ground(cx, az) - 0.3, az))
        }
      break
    case 'greenhouse': {
      const W = 6
      const D = 4
      const H = 2.4
      for (const e of [-1, 1]) {
        out.push(at(W, H, 0.14, 0, 0, e * (D / 2)))
        // The beds inside.
        out.push(at(W - 1.2, 0.4, 0.9, 0.3, 0, e))
        // The west side, either side of the open door.
        out.push(at(0.14, H, 1.3, -W / 2, 0, e * 1.35))
      }
      out.push(at(0.14, H, D, W / 2, 0, 0))
      break
    }
  }
  return out
}

const builtIn = new WeakMap<PhysicsWorld, Map<ProjectId, RAPIER.Collider[]>>()

/** Makes exactly the finished projects in `done` solid. Returns true when anything changed. */
export function setProjects(
  physics: PhysicsWorld,
  def: Pick<SurvivalDef, 'terrain' | 'pois'>,
  done: Iterable<ProjectId>,
): boolean {
  let built = builtIn.get(physics)
  if (!built) {
    built = new Map()
    builtIn.set(physics, built)
  }
  const want = new Set(done)
  let changed = false
  for (const id of want) {
    if (built.has(id)) continue
    const colliders = projectBlocks(def, id).map((b) =>
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(...b.half)
          .setTranslation(...b.center)
          .setCollisionGroups(MAP_COLLISION_GROUPS),
      ),
    )
    built.set(id, colliders)
    changed = true
  }
  for (const [id, colliders] of built) {
    if (want.has(id)) continue
    for (const c of colliders) physics.world.removeCollider(c, false)
    built.delete(id)
    changed = true
  }
  if (changed) physics.world.step()
  return changed
}

/** The ids of the finished projects among those shared (CampShared.projects). */
export const doneProjects = (projects: readonly { id: ProjectId; done?: number }[] | undefined) =>
  (projects ?? []).filter((p) => p.done !== undefined).map((p) => p.id)

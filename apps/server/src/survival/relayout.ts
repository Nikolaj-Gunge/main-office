import {
  type ChalkMark,
  drawIn,
  heightAt,
  mapBlocks,
  PERSON_QUERY_GROUPS,
  type PhysicsWorld,
  type PieceKind,
  placeProblem,
  RAPIER,
  type SurvivalDef,
  WORLD_HALF,
} from '@office-fps/shared'
import type { CharacterSave, WorldSave } from '../saves.ts'
import type { SavedPiece } from './building.ts'
import type { ChalkSpot } from './chalk.ts'

/**
 * Old saves into the drawn-in county (world.ts drawIn, v39; Miller's Lake moved in v40): a world
 * saved before then has walls, chalk, turned bodies, stains and graves where the places used to
 * be. Once, on load, each is pulled in towards Haven the same way the places were, and anything
 * that then lands in a lake, a building or off the map is let go. Marked done in the world save
 * (WorldSave.drawnIn) so it never runs twice. Characters are moved as they come back (resume).
 */

/** When the county was drawn in (ms): chalk and characters saved before this are in the old layout. */
export const DRAWN_IN_AT = Date.parse('2026-11-15T13:33:42Z')
/** Pieces this close (m) are one base, moved together so it stays in one piece. */
const BASE_GAP = 12
/** Kept this far inside the world's edge (m). */
const EDGE = 4

/** What moving things needs of the world as it is now. */
export interface RelayoutWorld {
  def: Pick<SurvivalDef, 'terrain' | 'pois' | 'roads' | 'rooms' | 'spots' | 'lakes'>
  /** A built piece would stand in something solid (physics mapBlocks). */
  blocks?(p: { kind: PieceKind; x: number; z: number; rot: number }, base: number): boolean
  /** Something solid where a person would stand. */
  solid?(x: number, y: number, z: number): boolean
  /** The surface a chalk mark lies on, found again near `spot` (null: nothing there now). */
  surface?(spot: ChalkSpot): ChalkSpot | null
}

/** What was done, for the log and the tests. */
export interface RelayoutCount {
  moved: number
  dropped: number
}

const ground = (w: RelayoutWorld, x: number, z: number) => heightAt(w.def.terrain, x, z)

/** On the map, and not in a lake. */
function open(w: RelayoutWorld, x: number, z: number): boolean {
  if (!Number.isFinite(x + z)) return false
  if (Math.abs(x) > WORLD_HALF - EDGE || Math.abs(z) > WORLD_HALF - EDGE) return false
  return !w.def.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 1)
}

/** Inside one of the buildings' rooms. */
const indoors = (w: RelayoutWorld, x: number, z: number) =>
  w.def.rooms.some((r) => x > r.min[0] && x < r.max[0] && z > r.min[1] && z < r.max[1])

/** A thing lying on the ground (a body, a stain, a grave): moved, or null if it can't be. */
function movePoint<T extends { x: number; y: number; z: number }>(
  w: RelayoutWorld,
  t: T,
): T | null {
  const [x, z] = drawIn(t.x, t.z)
  if (!open(w, x, z)) return null
  const y = ground(w, x, z)
  if (w.solid?.(x, y, z)) return null
  return { ...t, x, y, z }
}

/** A base: pieces near one another, moved together by where their middle is drawn in to. */
function bases(pieces: readonly SavedPiece[]): SavedPiece[][] {
  const groups: SavedPiece[][] = []
  const seen = new Set<number>()
  pieces.forEach((_, i) => {
    if (seen.has(i)) return
    const group: SavedPiece[] = []
    const todo = [i]
    seen.add(i)
    while (todo.length) {
      const p = pieces[todo.pop() as number] as SavedPiece
      group.push(p)
      pieces.forEach((q, j) => {
        if (seen.has(j) || Math.hypot(q.x - p.x, q.z - p.z) > BASE_GAP) return
        seen.add(j)
        todo.push(j)
      })
    }
    groups.push(group)
  })
  return groups
}

function moveBuilds(
  w: RelayoutWorld,
  pieces: readonly SavedPiece[],
  n: RelayoutCount,
): SavedPiece[] {
  const kept = new Map<SavedPiece, SavedPiece>()
  const standing: { id: number; kind: PieceKind; x: number; z: number; rot: number; hp: number }[] =
    []
  for (const group of bases(pieces.filter((p) => Number.isFinite(p.x + p.z)))) {
    const mx = group.reduce((s, p) => s + p.x, 0) / group.length
    const mz = group.reduce((s, p) => s + p.z, 0) / group.length
    const [nx, nz] = drawIn(mx, mz)
    for (const p of group) {
      const x = Math.round((p.x + nx - mx) * 10) / 10
      const z = Math.round((p.z + nz - mz) * 10) / 10
      const at = { kind: p.k, x, z, rot: p.r }
      const ok =
        open(w, x, z) &&
        !placeProblem(w.def, standing as never, at, (q, base) => !!w.blocks?.(q, base))
      if (!ok) {
        n.dropped++
        continue
      }
      standing.push({ id: standing.length + 1, ...at, hp: p.hp })
      kept.set(p, { ...p, x, z })
      if (x !== p.x || z !== p.z) n.moved++
    }
  }
  // In the order they were saved.
  return pieces.flatMap((p) => kept.get(p) ?? [])
}

function moveChalk<T extends ChalkMark>(w: RelayoutWorld, m: T): T | null {
  // Chalked since the draw-in: already where it belongs.
  if (m.at >= DRAWN_IN_AT) return m
  const [x, z] = drawIn(m.x, m.z)
  if (x === m.x && z === m.z) return m
  if (!open(w, x, z)) return null
  // As high over the ground as it was.
  const y = m.y - ground(w, m.x, m.z) + ground(w, x, z)
  const spot = { x, y, z, nx: m.nx, ny: m.ny, nz: m.nz }
  // Lying on the ground: still on the ground. On a wall or a tree: only if that's still there.
  const found = m.ny > 0.7 ? { ...spot, y: ground(w, x, z) + 0.02 } : (w.surface?.(spot) ?? null)
  return found ? { ...m, ...found } : null
}

/** Each of `list` moved, the ones that can't be dropped (and counted). */
function each<T>(list: readonly T[] | undefined, move: (t: T) => T | null, n: RelayoutCount): T[] {
  const out: T[] = []
  for (const t of list ?? []) {
    const moved = t && typeof t === 'object' ? move(t) : null
    if (!moved) n.dropped++
    else {
      if (moved !== t) n.moved++
      out.push(moved)
    }
  }
  return out
}

/**
 * The world save in the drawn-in county (a new object; `save` is left alone). Run it once, on a
 * save without `drawnIn`; the result has it set.
 */
export function relayoutWorld(
  save: WorldSave,
  w: RelayoutWorld,
): { world: WorldSave; count: RelayoutCount } {
  const n: RelayoutCount = { moved: 0, dropped: 0 }
  const world: WorldSave = { ...save, drawnIn: true }
  if (save.builds) world.builds = moveBuilds(w, save.builds, n)
  if (save.marks) world.marks = each(save.marks, (m) => moveChalk(w, m), n)
  if (save.turned) world.turned = each(save.turned, (t) => movePoint(w, t), n)
  if (save.echoes) world.echoes = each(save.echoes, (e) => movePoint(w, e), n)
  if (save.camp?.graves)
    world.camp = { ...save.camp, graves: each(save.camp.graves, (g) => movePoint(w, g), n) }
  return { world, count: n }
}

/**
 * Where a character saved in the old layout comes back: pulled in like everything else, or no
 * longer anywhere (undefined: they wake at Haven) if that's water, a wall or off the map.
 * Saves from after the draw-in come back as they are.
 */
export function relayoutCharacter(
  save: Pick<CharacterSave, 'pos' | 'at'>,
  w: RelayoutWorld,
): CharacterSave['pos'] {
  const pos = save.pos
  if (!pos || (save.at ?? 0) >= DRAWN_IN_AT) return pos
  const moved = movePoint(w, pos)
  if (!moved || indoors(w, moved.x, moved.z)) return undefined
  return moved
}

/** The world as it stands now, asked through its physics (the director's). */
export function relayoutOn(def: RelayoutWorld['def'], physics: PhysicsWorld): RelayoutWorld {
  return {
    def,
    blocks: (p, base) => mapBlocks(physics, p, base),
    solid: (x, y, z) =>
      physics.world.intersectionWithShape(
        { x, y: y + 0.9, z },
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Capsule(0.5, 0.3),
        undefined,
        undefined,
        physics.ground,
      ) !== null,
    surface: (spot) => {
      // From just off the face, back along its normal.
      const from = {
        x: spot.x + spot.nx * 0.6,
        y: spot.y + spot.ny * 0.6,
        z: spot.z + spot.nz * 0.6,
      }
      const dir = { x: -spot.nx, y: -spot.ny, z: -spot.nz }
      const hit = physics.world.castRayAndGetNormal(
        new RAPIER.Ray(from, dir),
        1.2,
        true,
        undefined,
        PERSON_QUERY_GROUPS,
      )
      if (!hit) return null
      const t = hit.timeOfImpact
      return {
        x: from.x + dir.x * t,
        y: from.y + dir.y * t,
        z: from.z + dir.z * t,
        nx: hit.normal.x,
        ny: hit.normal.y,
        nz: hit.normal.z,
      }
    },
  }
}

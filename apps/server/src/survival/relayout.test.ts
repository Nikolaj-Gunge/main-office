import { beforeAll, describe, expect, test } from 'bun:test'
import {
  buildDeadwood,
  type ChalkMark,
  createPhysicsWorld,
  DEFAULT_RULES,
  DEFAULT_WORLD_ID,
  drawIn,
  initPhysics,
  loadMap,
  mergeRules,
  placeProblem,
  seeded,
} from '@office-fps/shared'
import { Game } from '../game.ts'
import { freshWorld, MemoryStore, SAVE_VERSION, type WorldSave, worldKey } from '../saves.ts'
import type { SavedPiece } from './building.ts'
import type { ChalkSave } from './chalk.ts'
import { DRAWN_IN_AT, relayoutCharacter, relayoutWorld } from './relayout.ts'

beforeAll(async () => {
  await initPhysics()
})

const def = buildDeadwood().survival as NonNullable<ReturnType<typeof buildDeadwood>['survival']>
const ground = { def }
const lake = def.lakes[0] as { x: number; z: number; r: number }

/** An old-layout spot whose drawn-in place a wall may stand on (no physics: just the plan). */
function openOld(): [number, number] {
  for (let a = 0; a < 64; a++) {
    const x = Math.round(Math.cos(a) * 900)
    const z = 480 + Math.round(Math.sin(a) * 900)
    const [nx, nz] = drawIn(x, z)
    const ok = (dx: number) =>
      !placeProblem(def, [], { kind: 'wall', x: nx + dx, z: nz, rot: 0 }) &&
      Math.hypot(nx - lake.x, nz - lake.z) > lake.r + 20
    if (ok(-4) && ok(0) && ok(4)) return [x, z]
  }
  throw new Error('nowhere open')
}

/** An old-layout spot that is now under Miller's Lake. */
function oldUnderLake(): { x: number; z: number } {
  const wet = Array.from({ length: 400 }, (_, i) => ({
    x: lake.x + (i % 20) * 30 - 300,
    z: lake.z + Math.floor(i / 20) * 30 - 300,
  })).find(({ x, z }) => {
    const [nx, nz] = drawIn(x, z)
    return Math.hypot(nx - lake.x, nz - lake.z) < lake.r - 5
  })
  if (!wet) throw new Error('no old spot under the lake')
  return wet
}

const wall = (x: number, z: number): SavedPiece => ({ k: 'wall', x, z, r: 0, hp: 500, owner: 'a' })
const mark = (x: number, z: number, at: number): ChalkSave => ({
  id: 1,
  x,
  y: 0,
  z,
  nx: 0,
  ny: 1,
  nz: 0,
  sym: 0,
  a: -1,
  b: -1,
  at,
  by: 'a',
})

describe('old saves into the drawn-in county', () => {
  test('a base moves in as one piece; walls that land in the lake are let go', () => {
    const [x, z] = openOld()
    const wet = oldUnderLake()
    const save: WorldSave = {
      ...freshWorld(),
      builds: [wall(x - 2, z), wall(x, z), wall(x + 2, z), wall(wet.x, wet.z)],
    }
    const { world, count } = relayoutWorld(save, ground)
    expect(world.drawnIn).toBe(true)
    const kept = world.builds ?? []
    expect(kept.length).toBe(3)
    expect(count.dropped).toBe(1)
    // Still 2 m apart (moved together), and where the base's middle is drawn in to.
    expect(kept[1]?.x - (kept[0]?.x ?? 0)).toBeCloseTo(2)
    const [nx, nz] = drawIn(x, z)
    expect(kept[1]?.x).toBeCloseTo(nx, 0)
    expect(kept[1]?.z).toBeCloseTo(nz, 0)
    // Nothing else in the save is touched.
    expect(save.builds?.length).toBe(4)
  })

  test('bodies, stains and graves come in; old chalk on the ground too, new chalk stays put', () => {
    const [x, z] = openOld()
    const body = { name: 'Ann', look: 0, stuff: [], x, y: 3, z }
    const save: WorldSave = {
      ...freshWorld(),
      turned: [body, { ...body, name: 'Off', x: 5000 }],
      echoes: [{ id: 1, name: 'Bo', x, y: 0, z, frames: [], day: 1 }],
      marks: [mark(x, z, DRAWN_IN_AT - 1000), mark(x, z, DRAWN_IN_AT + 1000)],
    }
    const { world } = relayoutWorld(save, ground)
    const [nx, nz] = drawIn(x, z)
    expect(world.turned?.map((t) => t.name)).toEqual(['Ann'])
    expect(world.turned?.[0]?.x).toBe(nx)
    expect(world.echoes?.[0]?.z).toBe(nz)
    const [old, fresh] = world.marks as ChalkMark[]
    expect(old?.x).toBe(nx)
    expect(fresh?.x).toBe(x)
  })

  test('a chalk mark on a wall that is no longer there is rubbed out', () => {
    const [x, z] = openOld()
    const onWall = { ...mark(x, z, 0), nx: 1, ny: 0 }
    const gone = relayoutWorld({ ...freshWorld(), marks: [onWall] }, { def, surface: () => null })
    expect(gone.world.marks).toEqual([])
    const kept = relayoutWorld({ ...freshWorld(), marks: [onWall] }, { def, surface: (s) => s })
    expect(kept.world.marks?.length).toBe(1)
  })

  test('characters: old saves are pulled in, or wake at Haven; new saves stay', () => {
    const [x, z] = openOld()
    const pos = { x, y: 2, z, yaw: 1 }
    const moved = relayoutCharacter({ pos, at: DRAWN_IN_AT - 1 }, ground)
    expect([moved?.x, moved?.z]).toEqual(drawIn(x, z))
    expect(moved?.yaw).toBe(1)
    expect(relayoutCharacter({ pos, at: DRAWN_IN_AT + 1 }, ground)).toBe(pos)
    // Into the lake: back to Haven.
    const wet = oldUnderLake()
    expect(relayoutCharacter({ pos: { ...wet, y: 0, yaw: 0 } }, ground)).toBeUndefined()
    // Something solid there: Haven too.
    expect(relayoutCharacter({ pos }, { def, solid: () => true })).toBeUndefined()
  })

  test('runs once, on load, and the world save says so', async () => {
    const map = loadMap('deadwood')
    const store = new MemoryStore()
    const [x, z] = openOld()
    const old: WorldSave = {
      ...freshWorld(),
      turned: [{ name: 'Ann', look: 0, stuff: [], x, y: 0, z }],
    }
    await store.put(worldKey(DEFAULT_WORLD_ID), { v: SAVE_VERSION, data: old })
    const start = async () => {
      const game = new Game(map, createPhysicsWorld(map), seeded(7))
      game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
      await game.useSaves(store)
      game.saveAll()
      await game.saves.flush()
      return (await store.get(worldKey(DEFAULT_WORLD_ID))) as { data: WorldSave }
    }
    const once = await start()
    expect(once.data.drawnIn).toBe(true)
    const [nx, nz] = drawIn(x, z)
    const ann = once.data.turned?.find((t) => t.name === 'Ann')
    expect(ann?.x).toBe(nx)
    expect(ann?.z).toBe(nz)
    // Loaded again: left where it is.
    const twice = await start()
    expect(twice.data.turned?.find((t) => t.name === 'Ann')?.x).toBe(nx)
  })
})

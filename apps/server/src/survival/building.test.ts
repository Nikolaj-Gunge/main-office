import { beforeAll, describe, expect, test } from 'bun:test'
import {
  countOf,
  createPhysicsWorld,
  DAY_SECONDS,
  DECAY_DAYS,
  DEFAULT_RULES,
  give,
  heightAt,
  initPhysics,
  loadMap,
  mapBlocks,
  mergeRules,
  PIECES,
  type Piece,
  type PieceKind,
  PLAYER_PIECES,
  placeProblem,
  RAPIER,
  type SurvivalDef,
  type SurvivalSelf,
  seeded,
  snapPiece,
  syncForest,
  TICK_RATE,
  unpackPieces,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore } from '../saves.ts'
import type { Building } from './building.ts'
import type { SurvivalDirector } from './director.ts'
import type { Zed } from './horde.ts'

beforeAll(async () => {
  await initPhysics()
})

interface Insides {
  survivors: Map<number, { self: SurvivalSelf; player: ServerPlayer }>
  building: Building
  pool: ServerPlayer[]
}

async function server(store = new MemoryStore()) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const def = map.survival as SurvivalDef
  const join = async (name: string, account: string): Promise<ServerPlayer> => {
    await game.saves.loadCharacter(account)
    const id = game.join(name, { send: () => {}, account })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    p.protectedUntil = Number.POSITIVE_INFINITY
    return p
  }
  const self = (p: ServerPlayer) => {
    const s = insides.survivors.get(p.id)
    if (!s) throw new Error('not a survivor')
    return s.self
  }
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) game.step()
  }
  const stand = (p: ServerPlayer, x: number, z: number) => {
    p.state.pos = { x, y: heightOf(def, x, z), z }
    p.state.vel = { x: 0, y: 0, z: 0 }
  }
  /** Looks at (x, y, z) and presses E. */
  const useAt = (p: ServerPlayer, x: number, y: number, z: number) => {
    const s = p.state
    const dx = x - s.pos.x
    const dy = y - (s.pos.y + 1.6)
    const dz = z - s.pos.z
    s.yaw = Math.atan2(-dx, -dz)
    s.pitch = Math.atan2(dy, Math.hypot(dx, dz))
    director.onUse(p)
  }
  const build = (p: ServerPlayer, kit: string, x: number, z: number, rot = 0) =>
    game.handleAction(p.id, { a: 'build', kit, x, z, rot })
  const pieces = () => {
    game.match.broadcast()
    return unpackPieces(director.info().builds ?? [])
  }
  return {
    game,
    def,
    director,
    building: insides.building,
    insides,
    join,
    self,
    run,
    stand,
    useAt,
    build,
    pieces,
  }
}

/** Feet on the ground with a hair to spare. */
const heightOf = (def: SurvivalDef, x: number, z: number) => heightAt(def.terrain, x, z) + 0.02

/** Somewhere in the woods a wall may go (and the ground round it is clear too). */
function openGround(t: Awaited<ReturnType<typeof server>>): { x: number; z: number } {
  const start = t.def.pois.find((p) => p.kind === 'start') ?? t.def.pois[0]
  if (!start) throw new Error('no start')
  const physics = t.game.world.physics
  for (let r = 30; r < 300; r += 7) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
      const x = Math.round((start.x + Math.cos(a) * r) * 10) / 10
      const z = Math.round((start.z + Math.sin(a) * r) * 10) / 10
      syncForest(physics, [{ x, z }])
      const ok = (dx: number, dz: number, kind: PieceKind, rot = 0) => {
        const p = { kind, x: x + dx, z: z + dz, rot }
        return placeProblem(t.def, [], p, (q, base) => mapBlocks(physics, q, base)) === null
      }
      // Room for a little camp: a row of walls, a door, a crate and spikes.
      if (
        ok(0, 0, 'wall') &&
        ok(2, 0, 'wall') &&
        ok(-2, 0, 'door') &&
        ok(0, 3, 'stash') &&
        ok(0, -3, 'spikes') &&
        ok(3, 3, 'spikes')
      )
        return { x, z }
    }
  }
  throw new Error('no open ground')
}

describe('building: where things may go', () => {
  test('not in Haven, not on a road, not by a doorway; fine out in the woods', async () => {
    const t = await server()
    const haven = t.def.pois.find((p) => p.safe)
    const road = t.def.roads[0]?.line[5]
    const door = t.def.spots.find((s) => s.door)
    if (!haven || !road || !door) throw new Error('map is missing things')
    const wall = (x: number, z: number) => ({ kind: 'wall' as const, x, z, rot: 0 })
    expect(placeProblem(t.def, [], wall(haven.x + 3, haven.z))).toContain('Haven')
    expect(placeProblem(t.def, [], wall(road.x, road.z))).toContain('road')
    expect(placeProblem(t.def, [], wall(door.x + 1, door.z + 1))).not.toBeNull()
    const g = openGround(t)
    expect(placeProblem(t.def, [], wall(g.x, g.z))).toBeNull()
    // Not on top of another piece; but a wall meets the next one end to end.
    const one: Piece = { id: 1, kind: 'wall', x: g.x, z: g.z, rot: 0, hp: 600 }
    expect(placeProblem(t.def, [one], wall(g.x + 0.5, g.z))).toContain('already')
    const snapped = snapPiece([one], { kind: 'wall', x: g.x + 2.3, z: g.z + 0.2, rot: 0 })
    expect(snapped.x).toBeCloseTo(g.x + 2)
    expect(snapped.z).toBeCloseTo(g.z)
    expect(placeProblem(t.def, [one], { kind: 'wall', ...snapped })).toBeNull()
    // Round the corner too.
    const corner = snapPiece([one], { kind: 'wall', x: g.x + 1.1, z: g.z + 0.8, rot: 2 })
    expect(corner.x).toBeCloseTo(g.x + 1)
    expect(corner.z).toBeCloseTo(g.z + 1)
    expect(placeProblem(t.def, [one], { kind: 'wall', ...corner })).toBeNull()
  })

  test('a kit is used up putting a piece up; no kit, too far, or over the cap: nothing', async () => {
    const t = await server()
    const p = await t.join('A', 'acct-a')
    t.run(0.5)
    const g = openGround(t)
    t.stand(p, g.x, g.z + 3)
    const me = t.self(p)
    me.pack = 'pack_military'
    t.build(p, 'wallkit', g.x, g.z)
    expect(t.pieces()).toHaveLength(0)
    give(me, 'wallkit', 2)
    t.build(p, 'wallkit', g.x + 30, g.z)
    expect(t.pieces()).toHaveLength(0)
    t.build(p, 'wallkit', g.x, g.z)
    expect(t.pieces()).toHaveLength(1)
    expect(countOf(me.inv, 'wallkit')).toBe(1)
    // Standing where it would go: it doesn't.
    t.stand(p, g.x + 2, g.z)
    t.build(p, 'wallkit', g.x + 2, g.z)
    expect(t.pieces()).toHaveLength(1)
    // Thirty is all anyone gets.
    t.building.restore(
      Array.from({ length: PLAYER_PIECES }, (_, i) => ({
        k: 'spikes' as const,
        x: g.x + 200 + i * 3,
        z: g.z,
        r: 0,
        hp: 100,
        owner: 'acct-a',
      })),
    )
    t.stand(p, g.x, g.z + 3)
    t.build(p, 'wallkit', g.x, g.z)
    expect(t.building.countOf('acct-a')).toBe(PLAYER_PIECES)
    expect(countOf(me.inv, 'wallkit')).toBe(1)
  })
})

describe('building: walls, doors and the dead', () => {
  test('a wall is solid; a door is solid shut and open when opened', async () => {
    const t = await server()
    const p = await t.join('A', 'acct-a')
    t.run(0.5)
    const g = openGround(t)
    t.stand(p, g.x - 2, g.z + 3)
    const me = t.self(p)
    me.pack = 'pack_military'
    give(me, 'wallkit', 1)
    give(me, 'doorkit', 1)
    t.build(p, 'wallkit', g.x, g.z)
    t.build(p, 'doorkit', g.x - 2, g.z)
    expect(t.pieces().map((q) => q.kind)).toEqual(['wall', 'door'])
    const world = t.game.world.physics.world
    const y = heightOf(t.def, g.x, g.z) + 1
    // A ray along z through the middle of each (rot 0: they run along x).
    const hits = (x: number) =>
      world.castRay(new RAPIER.Ray({ x, y, z: g.z + 2 }, { x: 0, y: 0, z: -1 }), 4, true) !== null
    expect(hits(g.x)).toBe(true)
    expect(hits(g.x - 2)).toBe(true)
    const door = t.pieces().find((q) => q.kind === 'door') as Piece
    t.stand(p, g.x - 2.5, g.z + 1.6)
    t.useAt(p, door.x, y, door.z)
    expect(t.pieces().find((q) => q.kind === 'door')?.open).toBe(true)
    expect(hits(g.x - 2)).toBe(false)
    t.useAt(p, door.x, y, door.z)
    expect(t.pieces().find((q) => q.kind === 'door')?.open).toBeUndefined()
    expect(hits(g.x - 2)).toBe(true)
  })

  test('the dead batter a wall down to get at you', async () => {
    const t = await server()
    const p = await t.join('A', 'acct-a')
    t.run(1)
    const g = openGround(t)
    t.stand(p, g.x, g.z - 1.2)
    const me = t.self(p)
    me.pack = 'pack_military'
    give(me, 'wallkit', 1)
    t.build(p, 'wallkit', g.x, g.z)
    const wall = () => t.pieces().find((q) => q.kind === 'wall')
    expect(wall()?.hp).toBe(PIECES.wall.hp)
    const zombie = t.insides.pool.find((z) => z.state.alive) ?? t.insides.pool[0]
    if (!zombie) throw new Error('no zombie')
    t.game.placeZombie(
      zombie,
      { pos: [g.x, heightOf(t.def, g.x, g.z + 1.2), g.z + 1.2], yaw: 0 },
      5000,
    )
    t.game.applyRules(zombie)
    const zed = zombie.zombie as Zed
    zed.alert(p.state.pos, t.game.tick / TICK_RATE)
    t.run(5)
    expect(wall()?.hp ?? 0).toBeLessThan(PIECES.wall.hp)
    // Still on its own side.
    expect(zombie.state.pos.z).toBeGreaterThan(g.z)
    for (let i = 0; i < 40 && wall(); i++) {
      zed.alert(p.state.pos, t.game.tick / TICK_RATE)
      t.run(2)
    }
    expect(wall()).toBeUndefined()
  })

  test('spikes slow the dead, hurt them and wear out', async () => {
    const t = await server()
    const p = await t.join('A', 'acct-a')
    t.run(0.5)
    const g = openGround(t)
    t.stand(p, g.x + 3, g.z - 3)
    const me = t.self(p)
    me.pack = 'pack_military'
    give(me, 'spikekit', 1)
    t.build(p, 'spikekit', g.x, g.z - 3)
    expect(t.pieces()).toHaveLength(1)
    const zombie = t.insides.pool[0] as ServerPlayer
    t.game.placeZombie(zombie, { pos: [g.x, heightOf(t.def, g.x, g.z - 3), g.z - 3], yaw: 0 }, 5000)
    zombie.health = 5000
    const zed = zombie.zombie as Zed
    const before = zed.speedFactor
    t.run(0.3)
    expect(zed.slowed).toBe(true)
    expect(zed.speedFactor).toBeLessThan(before)
    zombie.state.pos = { x: g.x, y: heightOf(t.def, g.x, g.z - 3), z: g.z - 3 }
    t.run(1.5)
    expect(zombie.health).toBeLessThan(5000)
    expect(t.pieces()[0]?.hp ?? 0).toBeLessThan(PIECES.spikes.hp)
  })
})

describe('building: decay, mending, stashes and saves', () => {
  test('pieces rot away over a few days unless mended with planks', async () => {
    const t = await server()
    const p = await t.join('A', 'acct-a')
    t.run(0.5)
    const g = openGround(t)
    t.stand(p, g.x, g.z + 1.5)
    const me = t.self(p)
    me.pack = 'pack_military'
    give(me, 'wallkit', 1)
    t.build(p, 'wallkit', g.x, g.z)
    t.building.decay(DECAY_DAYS * DAY_SECONDS * 0.5)
    const half = t.pieces()[0]?.hp ?? 0
    expect(half).toBeLessThan(PIECES.wall.hp * 0.55)
    give(me, 'planks', 1)
    const y = heightOf(t.def, g.x, g.z) + 1.2
    t.useAt(p, g.x, y, g.z)
    expect(t.pieces()[0]?.hp ?? 0).toBeGreaterThan(half + 100)
    expect(countOf(me.inv, 'planks')).toBe(0)
    t.building.decay(DECAY_DAYS * DAY_SECONDS)
    expect(t.pieces()).toHaveLength(0)
  })

  test('only the owner opens a stash; what is in it is saved with the world', async () => {
    const store = new MemoryStore()
    const t = await server(store)
    const a = await t.join('A', 'acct-a')
    const b = await t.join('B', 'acct-b')
    t.run(0.5)
    const g = openGround(t)
    t.stand(a, g.x, g.z + 4.5)
    t.stand(b, g.x + 1.5, g.z + 4.5)
    const me = t.self(a)
    me.pack = 'pack_military'
    give(me, 'stashkit', 1)
    give(me, 'beans', 1)
    t.build(a, 'stashkit', g.x, g.z + 3)
    const crate = t.pieces()[0] as Piece
    expect(crate.kind).toBe('stash')
    const y = heightOf(t.def, crate.x, crate.z) + 0.4
    t.useAt(b, crate.x, y, crate.z)
    expect(t.self(b).box ?? null).toBeNull()
    t.useAt(a, crate.x, y, crate.z)
    expect(t.self(a).box?.kind).toBe('stash')
    const beans = me.inv.find((s) => s.item === 'beans')
    if (!beans) throw new Error('no beans')
    t.game.handleAction(a.id, {
      a: 'move',
      from: { c: beans.c, x: beans.x, y: beans.y },
      to: { box: true },
    })
    expect(t.building.stash(crate.id)?.box.items.map((s) => [s.item, s.n])).toEqual([['beans', 1]])
    // B can't take it down either.
    b.state.crouched = true
    t.useAt(b, crate.x, y, crate.z)
    expect(t.pieces()).toHaveLength(1)

    await t.game.saveAll()
    const again = await server(store)
    const kept = again.pieces()
    expect(kept.map((q) => [q.kind, q.x, q.z])).toEqual([['stash', crate.x, crate.z]])
    const id = kept[0]?.id ?? 0
    expect(again.building.stash(id)?.box.items.map((s) => [s.item, s.n])).toEqual([['beans', 1]])
    // And it is solid again after the restart.
    const world = again.game.world.physics.world
    const ray = new RAPIER.Ray({ x: crate.x, y: y, z: crate.z + 2 }, { x: 0, y: 0, z: -1 })
    expect(world.castRay(ray, 4, true)).not.toBeNull()
  })
})

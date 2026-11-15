import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ALPHA_NEAR,
  ALPHA_RESPAWN_MS,
  ALPHAS,
  baseKind,
  createPhysicsWorld,
  DEFAULT_RULES,
  ITEMS,
  initPhysics,
  isAlpha,
  loadMap,
  mergeRules,
  SHOPS,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  UNLOCKS,
  ZombieKind,
  zombieScale,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore, SAVE_VERSION } from '../saves.ts'
import { CHARGE_BOOST, CHARGE_SECONDS, LEAP_SPEED } from './alphas.ts'
import type { SurvivalDirector } from './director.ts'
import { KINDS, type Zed } from './horde.ts'

beforeAll(async () => {
  await initPhysics()
})

const def = () => {
  const d = loadMap('deadwood').survival
  if (!d) throw new Error('no survival map')
  return d
}

describe('the named alphas', () => {
  test('each haunts a place that exists, and drops and unlocks things that exist', () => {
    const d = def()
    expect(ALPHAS.length).toBe(3)
    for (const a of ALPHAS) {
      expect(d.pois.some((p) => p.key === a.poi)).toBe(true)
      expect(isAlpha(a.kind)).toBe(true)
      for (const [item] of a.drop) expect(ITEMS[item]).toBeDefined()
      expect(UNLOCKS[a.unlock]).toBeDefined()
      // What it unlocks: a new shelf at Gus's.
      expect(SHOPS.gus?.some((s) => s.unlock === a.unlock)).toBe(true)
    }
  })

  test("bigger and far tougher than the kind they're a version of", () => {
    for (const a of ALPHAS) {
      const base = baseKind(a.kind)
      expect(base).not.toBe(a.kind)
      expect(zombieScale(a.kind)).toBeGreaterThan(zombieScale(base))
      expect(KINDS[a.kind]?.health ?? 0).toBeGreaterThan((KINDS[base]?.health ?? 0) * 4)
    }
    expect(baseKind(ZombieKind.Walker)).toBe(ZombieKind.Walker)
  })
})

async function server(store = new MemoryStore()) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as {
    zeds: Map<number, Zed>
    survivors: Map<number, { self: SurvivalSelf }>
    loot: Map<number, { item: string; x: number; z: number }>
  }
  const join = (name: string): ServerPlayer => {
    const id = game.join(name, { send: () => {} })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    p.protectedUntil = Number.POSITIVE_INFINITY
    const sv = insides.survivors.get(p.id)
    if (sv) sv.self.age = 99999
    return p
  }
  /** Stands `p` this far east of the alpha's place, for `seconds`. */
  const near = (p: ServerPlayer, key: string, seconds: number, off = 60) => {
    const a = ALPHAS.find((x) => x.key === key)
    const poi = def().pois.find((x) => x.key === a?.poi)
    if (!poi) throw new Error('no place')
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
      p.state.pos = { x: poi.x + off, y: poi.y + 0.1, z: poi.z }
      p.health = p.maxHealth
      game.step()
    }
  }
  return { game, director, join, near, insides, store }
}

describe('alphas in the world', () => {
  test('one turns up when somebody comes near its place, named, and not before', async () => {
    const { director, join, near } = await server()
    const p = join('Ann')
    near(p, 'teeth', 2, ALPHA_NEAR + 200)
    expect(director.alphas.out('teeth')).toBeNull()
    near(p, 'teeth', 2)
    const z = director.alphas.out('teeth')
    expect(z?.name).toBe('Old Teeth')
    expect(z?.zombie?.kind).toBe(ZombieKind.AlphaRunner)
    expect(z?.maxHealth).toBeGreaterThan(1000)
    // Only the one.
    near(p, 'teeth', 2)
    expect(director.alphas.out('teeth')).toBe(z)
  }, 60000)

  test('the Sawmill Brute charges: much faster for a moment, then itself again', async () => {
    const { director, join, near, insides } = await server()
    const p = join('Ann')
    near(p, 'sawmill', 2)
    const z = director.alphas.out('sawmill')
    const zed = z && insides.zeds.get(z.id)
    if (!z || !zed) throw new Error('no brute')
    const before = zed.speedFactor
    zed.mood = 'chase'
    zed.targetId = p.id
    z.state.pos = { x: p.state.pos.x + 15, y: p.state.pos.y, z: p.state.pos.z }
    director.alphas.step()
    expect(zed.boost).toBe(CHARGE_BOOST)
    expect(zed.speedFactor).toBeGreaterThan(before * 2)
    for (let i = 0; i < (CHARGE_SECONDS + 0.5) * TICK_RATE; i++) {
      p.health = p.maxHealth
      director.step()
      ;(director as unknown as { game: Game }).game.tick++
    }
    expect(zed.boost).toBe(1)
  }, 60000)

  test('Old Teeth leaps at you from a few metres off', async () => {
    const { director, join, near, insides } = await server()
    const p = join('Ann')
    near(p, 'teeth', 2)
    const z = director.alphas.out('teeth')
    const zed = z && insides.zeds.get(z.id)
    if (!z || !zed) throw new Error('no runner')
    zed.mood = 'chase'
    zed.targetId = p.id
    z.state.pos = { x: p.state.pos.x - 8, y: p.state.pos.y, z: p.state.pos.z }
    z.state.grounded = true
    director.alphas.step()
    expect(z.state.vel.x).toBeCloseTo(LEAP_SPEED, 1)
    expect(z.state.vel.y).toBeGreaterThan(4)
    expect(z.state.grounded).toBe(false)
  }, 60000)

  test("the Choir's call brings more of the dead", async () => {
    const { game, director, join, near, insides } = await server()
    const p = join('Ann')
    near(p, 'choir', 2)
    const z = director.alphas.out('choir')
    const zed = z && insides.zeds.get(z.id)
    if (!z || !zed) throw new Error('no choir')
    const alive = () => [...game.players.values()].filter((x) => x.zombie && x.state.alive).length
    // Make room in the pool for what it calls.
    for (const x of game.players.values())
      if (x.zombie && x !== z && x.state.alive) game.retireZombie(x)
    const before = alive()
    zed.mood = 'chase'
    zed.targetId = p.id
    director.alphas.step()
    expect(alive()).toBeGreaterThan(before)
  }, 60000)

  test('killed: trophy and things drop, Gus gets new stock, the radio says so, it stays dead', async () => {
    const store = new MemoryStore()
    const { game, director, join, near, insides } = await server(store)
    const p = join('Ann')
    near(p, 'teeth', 2)
    const z = director.alphas.out('teeth')
    if (!z) throw new Error('no runner')
    const at = { ...z.state.pos }
    game.killPlayer(z.id, p.id)
    const dropped = [...insides.loot.values()].filter((l) => Math.hypot(l.x - at.x, l.z - at.z) < 3)
    expect(dropped.some((l) => l.item === 'trophy_jaw')).toBe(true)
    expect(director.story.unlocks).toContain('alpha_teeth')
    expect(director.radio.waiting.some((e) => e.kind === 'alpha')).toBe(true)
    expect(director.alphas.resting('teeth')).toBe(true)
    // It doesn't come back while it's resting.
    near(p, 'teeth', 3)
    expect(director.alphas.out('teeth')).toBeNull()

    // Kept in the world's save: a restart still has it dead, and Gus still has the rifles.
    near(p, 'teeth', 6)
    await game.saves.flush()
    expect(game.saves.world.alphas?.teeth).toBeGreaterThan(0)
    expect(game.saves.world.unlocks).toContain('alpha_teeth')
    const again = await server(store)
    expect(again.director.alphas.resting('teeth')).toBe(true)
    expect(again.director.story.unlocks).toContain('alpha_teeth')
    const q = again.join('Bea')
    again.near(q, 'teeth', 3)
    expect(again.director.alphas.out('teeth')).toBeNull()
  }, 120000)

  test('back after a few days, and the radio notices', async () => {
    const store = new MemoryStore()
    const long = Date.now() - ALPHA_RESPAWN_MS - 1000
    await store.put('world', {
      v: SAVE_VERSION,
      data: {
        epoch: 0,
        done: [],
        unlocks: ['alpha_sawmill'],
        found: [],
        gates: 0,
        boards: [],
        alphas: { sawmill: long },
      },
    })
    const { director, join, near } = await server(store)
    expect(director.alphas.resting('sawmill')).toBe(false)
    const p = join('Ann')
    near(p, 'sawmill', 2)
    expect(director.alphas.out('sawmill')?.name).toBe('the Sawmill Brute')
    expect(director.radio.log.some((l) => l.includes('the Sawmill Brute'))).toBe(true)
    // Its unlock stays: what the world gained, it keeps.
    expect(director.story.unlocks).toContain('alpha_sawmill')
  }, 60000)
})

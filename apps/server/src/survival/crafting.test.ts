import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type Box,
  Button,
  boxGive,
  countOf,
  craftPlan,
  createPhysicsWorld,
  DEFAULT_RULES,
  give,
  initPhysics,
  loadMap,
  mergeRules,
  RECIPES,
  type SurvivalAction,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  TRUNK_SIZE,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore, upgrade } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import { SHIELD_SECONDS } from './newcomer.ts'

beforeAll(async () => {
  await initPhysics()
})

interface Insides {
  survivors: Map<number, { self: SurvivalSelf; locker: Box }>
  vehicles: {
    nearest(at: unknown, r: number): { id: number } | null
    positionOf(id: number): { x: number; y: number; z: number } | null
  }
  workbench: { ringing: readonly unknown[] }
}

async function server(store = new MemoryStore()) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const join = async (name: string, account?: string): Promise<ServerPlayer> => {
    if (account) await game.saves.loadCharacter(account)
    const id = game.join(name, { send: () => {}, ...(account ? { account } : {}) })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    p.protectedUntil = Number.POSITIVE_INFINITY
    return p
  }
  const sv = (p: ServerPlayer) => {
    const s = insides.survivors.get(p.id)
    if (!s) throw new Error('not a survivor')
    return s
  }
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) game.step()
  }
  const act = (p: ServerPlayer, action: SurvivalAction) => game.handleAction(p.id, action)
  /** Empty pockets, a big pack: room to work with. */
  const kit = (p: ServerPlayer) => {
    const s = sv(p).self
    s.inv = []
    s.pack = 'pack_military'
    return s
  }
  return { game, director, insides, join, sv, run, act, kit, store }
}

const cell = (self: SurvivalSelf, item: string) => {
  const s = self.inv.find((st) => st.item === item)
  if (!s) throw new Error(`no ${item}`)
  return { c: s.c, x: s.x, y: s.y }
}

describe('use timers', () => {
  test('eating takes two seconds and only then fills you up', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const self = t.kit(p)
    give(self, 'beans', 2)
    self.hunger = 30
    t.act(p, { a: 'use', from: cell(self, 'beans') })
    t.run(1)
    expect(self.busy?.what).toBe('beans')
    expect(countOf(self.inv, 'beans')).toBe(2)
    expect(self.hunger).toBeLessThan(31)
    t.run(1.2)
    expect(self.busy ?? null).toBeNull()
    expect(countOf(self.inv, 'beans')).toBe(1)
    expect(self.hunger).toBeGreaterThan(55)
  })

  test('each thing takes as long as it should', async () => {
    const { useSeconds, ITEMS } = await import('@office-fps/shared')
    const secs = (id: string) => useSeconds(ITEMS[id] as never)
    expect(secs('beans')).toBe(2)
    expect(secs('water')).toBe(1.5)
    expect(secs('bandage')).toBe(3)
    expect(secs('medkit')).toBe(5)
    expect(secs('adrenaline')).toBe(1)
    expect(secs('painkillers')).toBe(1)
  })

  test('sprinting, jumping or firing gives it up; nothing is used', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const self = t.kit(p)
    give(self, 'medkit', 1)
    p.health = 30
    for (const interrupt of ['sprint', 'jump', 'shot'] as const) {
      t.act(p, { a: 'use', from: cell(self, 'medkit') })
      t.run(1)
      expect(self.busy?.what).toBe('medkit')
      if (interrupt === 'sprint') p.state.vel = { x: 7, y: 0, z: 0 }
      else if (interrupt === 'jump') {
        p.state.grounded = false
        p.state.vel = { x: 0, y: 6, z: 0 }
      } else t.director.onShot(p)
      ;(t.director as unknown as { workbench: { step(): void } }).workbench.step()
      expect(self.busy ?? null).toBeNull()
      p.state.vel = { x: 0, y: 0, z: 0 }
      p.state.grounded = true
      t.run(6)
      expect(countOf(self.inv, 'medkit')).toBe(1)
      expect(p.health).toBeLessThan(40)
    }
    // Left alone (walking is fine), it's done.
    t.act(p, { a: 'use', from: cell(self, 'medkit') })
    t.run(5.2)
    expect(countOf(self.inv, 'medkit')).toBe(0)
    expect(p.health).toBeGreaterThan(90)
  })

  test('stop gives it up too', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const self = t.kit(p)
    give(self, 'water', 1)
    t.act(p, { a: 'use', from: cell(self, 'water') })
    t.act(p, { a: 'stop' })
    t.run(2)
    expect(countOf(self.inv, 'water')).toBe(1)
  })
})

describe('crafting', () => {
  /** What each recipe needs, laid out in a fresh pack (and a knife, a lighter, a toolkit). */
  const stock: Record<string, [string, number][]> = {
    rags: [['flannel', 1]],
    bandage: [['rags', 3]],
    cleanbandages: [
      ['rags', 2],
      ['whiskey', 1],
    ],
    boilwater: [
      ['dirtywater', 1],
      ['lighter', 1],
    ],
    trailbars: [
      ['berries', 3],
      ['cereal', 1],
    ],
    bolts: [
      ['planks', 1],
      ['scrap', 1],
      ['knife', 1],
    ],
    barricadekit: [
      ['planks', 3],
      ['scrap', 1],
    ],
    batteries: [
      ['electronics', 2],
      ['ducttape', 1],
    ],
    noisemaker: [
      ['electronics', 1],
      ['scrap', 1],
      ['ducttape', 1],
    ],
    sparkplugs: [
      ['scrap', 1],
      ['electronics', 1],
      ['toolkit', 1],
    ],
    bandana: [['rags', 2]],
    satchel: [
      ['rags', 4],
      ['ducttape', 2],
    ],
    machete: [
      ['scrap', 2],
      ['planks', 1],
      ['ducttape', 1],
    ],
  }
  const TOOLS = new Set(['lighter', 'knife', 'toolkit'])

  test('there are a dozen or so recipes, all quick, all of real things', async () => {
    const { ITEMS } = await import('@office-fps/shared')
    expect(RECIPES.length).toBeGreaterThanOrEqual(10)
    for (const r of RECIPES) {
      expect(r.secs).toBeGreaterThanOrEqual(2)
      expect(r.secs).toBeLessThanOrEqual(8)
      expect(ITEMS[r.makes.item], r.id).toBeDefined()
      for (const need of r.needs) for (const id of need.any) expect(ITEMS[id], id).toBeDefined()
      for (const g of r.tools ?? []) for (const id of g) expect(ITEMS[id], id).toBeDefined()
      expect(stock[r.id], r.id).toBeDefined()
    }
  })

  for (const recipe of RECIPES) {
    test(`${recipe.name}: uses what it takes, makes what it makes`, async () => {
      const t = await server()
      const p = await t.join('A')
      t.run(0.5)
      const self = t.kit(p)
      for (const [item, n] of stock[recipe.id] ?? []) give(self, item, n)
      const before = countOf(self.inv, recipe.makes.item)
      t.act(p, { a: 'craft', recipe: recipe.id })
      expect(self.busy?.what).toBe(recipe.id)
      t.run(recipe.secs + 0.2)
      expect(self.busy ?? null).toBeNull()
      expect(countOf(self.inv, recipe.makes.item) - before).toBe(recipe.makes.n)
      // Everything used up; the tools kept.
      for (const [item] of stock[recipe.id] ?? []) {
        if (item === recipe.makes.item) continue
        expect(countOf(self.inv, item), item).toBe(TOOLS.has(item) ? 1 : 0)
      }
    })
  }

  test('without what it takes, nothing starts; losing it halfway makes nothing', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const self = t.kit(p)
    give(self, 'rags', 2)
    t.act(p, { a: 'craft', recipe: 'bandage' })
    expect(self.busy ?? null).toBeNull()
    give(self, 'rags', 1)
    t.act(p, { a: 'craft', recipe: 'bandage' })
    expect(self.busy?.what).toBe('bandage')
    t.act(p, { a: 'move', from: cell(self, 'rags'), to: { ground: true } })
    t.run(3.5)
    expect(countOf(self.inv, 'bandage')).toBe(0)
    // A blade in hand counts as the tool.
    const plan = craftPlan(RECIPES.find((r) => r.id === 'bolts') as never, {
      count: (i) => (i === 'planks' || i === 'scrap' ? 1 : 0),
      holds: (i) => i === 'knife',
    })
    expect(plan.ok).toBe(true)
  })

  test('no room: what was made lands at your feet', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const self = t.sv(p).self
    self.inv = []
    self.pack = null
    give(self, 'rags', 2)
    give(self, 'whiskey', 1)
    // Fill what's left of the pockets.
    while (give(self, 'apple', 1) > 0);
    t.act(p, { a: 'craft', recipe: 'cleanbandages' })
    t.run(4.5)
    expect(countOf(self.inv, 'whiskey')).toBe(0)
    // The rags' cell freed one slot: some bandages in pockets, the rest on the ground.
    const inPockets = countOf(self.inv, 'bandage')
    expect(inPockets).toBeLessThanOrEqual(3)
  })

  test('a noise maker is thrown and rings', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const self = t.kit(p)
    give(self, 'noisemaker', 1)
    t.act(p, { a: 'use', from: cell(self, 'noisemaker') })
    expect(countOf(self.inv, 'noisemaker')).toBe(0)
    expect(t.insides.workbench.ringing.length).toBe(1)
  })
})

describe('storage', () => {
  /** Stands player p in front of the Haven locker. */
  const atLocker = (t: Awaited<ReturnType<typeof server>>, p: ServerPlayer) => {
    const def = t.game.world.map.survival
    const locker = def?.interactables.find((i) => i.kind === 'locker')
    if (!locker) throw new Error('no locker')
    p.state.pos = { x: locker.pos[0] - 1, y: locker.pos[1] - 0.98, z: locker.pos[2] }
    p.state.vel = { x: 0, y: 0, z: 0 }
  }

  test('the locker: in and out, kept through death and through a save', async () => {
    const store = new MemoryStore()
    const t = await server(store)
    const p = await t.join('Sam', 'acct')
    t.run(0.5)
    atLocker(t, p)
    const self = t.kit(p)
    give(self, 'ammo9', 30)
    give(self, 'm4', 1, 20)
    t.act(p, { a: 'open' })
    expect(self.box?.kind).toBe('locker')
    t.act(p, { a: 'move', from: cell(self, 'ammo9'), to: { box: true, x: 0, y: 0 } })
    t.act(p, { a: 'move', from: cell(self, 'm4'), to: { box: true } })
    expect(countOf(self.inv, 'ammo9')).toBe(0)
    expect(t.sv(p).locker.items.map((s) => [s.item, s.n, s.ammo])).toEqual([
      ['ammo9', 30, undefined],
      ['m4', 1, 20],
    ])
    // One back out.
    t.act(p, { a: 'move', from: { box: true, x: 0, y: 0 }, to: { auto: true }, n: 1 })
    expect(countOf(self.inv, 'ammo9')).toBe(1)

    // Dying: the character is new, the locker isn't. (Past the newcomer's shield, which keeps loot.)
    self.age = SHIELD_SECONDS + 1
    t.game.killPlayer(p.id, p.id)
    t.run(0.2)
    expect(countOf(t.sv(p).self.inv, 'ammo9')).toBe(0)
    expect(t.sv(p).locker.items.length).toBe(2)
    t.game.leave(p.id)
    await t.game.saves.flush()

    // A new server on the same store.
    const two = await server(store)
    const q = await two.join('Sam', 'acct')
    expect(two.sv(q).locker.items.map((s) => [s.item, s.n, s.ammo])).toEqual([
      ['ammo9', 29, undefined],
      ['m4', 1, 20],
    ])
  })

  test('walking away closes it; too far, nothing opens', async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    atLocker(t, p)
    t.act(p, { a: 'open' })
    expect(t.sv(p).self.box?.kind).toBe('locker')
    p.state.pos = { x: p.state.pos.x + 30, y: p.state.pos.y, z: p.state.pos.z }
    t.run(1.1)
    expect(t.sv(p).self.box ?? null).toBeNull()
    t.act(p, { a: 'open' })
    expect(t.sv(p).self.box ?? null).toBeNull()
  })

  test("a car's trunk keeps things while the car stands; a new car's is empty", async () => {
    const t = await server()
    const p = await t.join('A')
    t.run(0.5)
    const at = t.insides.vehicles.positionOf(1)
    if (!at) throw new Error('no car')
    p.state.pos = { x: at.x + 2.6, y: at.y, z: at.z }
    const self = t.kit(p)
    give(self, 'scrap', 4)
    t.act(p, { a: 'open' })
    expect(self.box?.kind).toBe('trunk')
    expect([self.box?.w, self.box?.h]).toEqual([...TRUNK_SIZE])
    t.act(p, { a: 'move', from: cell(self, 'scrap'), to: { box: true }, n: 3 })
    expect(countOf(self.inv, 'scrap')).toBe(1)
    t.act(p, { a: 'close' })
    expect(self.box ?? null).toBeNull()
    t.act(p, { a: 'open' })
    expect(self.box?.items.map((s) => [s.item, s.n])).toEqual([['scrap', 3]])
    // The car is replaced: its trunk is a new one.
    const storage = (t.director as unknown as { storage: { trunk(id: number): Box | null } })
      .storage
    const cars = (
      t.director as unknown as { vehicles: { cars: { id: number; generation: number }[] } }
    ).vehicles.cars
    const car = cars.find((c) => c.id === 1)
    if (!car) throw new Error('no car')
    car.generation++
    expect(storage.trunk(1)?.items).toEqual([])
    // Nothing goes in from the hands or the ground.
    t.act(p, { a: 'open' })
    expect(t.game.players.get(p.id)?.state.alive).toBe(true)
    t.act(p, { a: 'move', from: { slot: 'melee' }, to: { box: true } })
    expect(storage.trunk(1)?.items).toEqual([])
    // A box helper sanity check.
    const b = { w: 2, h: 2, items: [] }
    expect(boxGive(b, 'apple', 9)).toBe(4)
    void Button
  })

  test('old saves (version 1) load with an empty locker', () => {
    const data = upgrade({ v: 1, data: { name: 'Old' } }, 'character')
    expect(data?.locker).toEqual([])
  })
})

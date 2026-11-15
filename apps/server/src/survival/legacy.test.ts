import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  DEFAULT_RULES,
  freshLife,
  give,
  initPhysics,
  loadMap,
  mergeRules,
  PICK_SECONDS,
  type SurvivalAction,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  ZombieKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore, Saves } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import { causeOfDeath } from './legacy.ts'
import { SHIELD_SECONDS } from './newcomer.ts'

beforeAll(async () => {
  await initPhysics()
})

interface Insides {
  survivors: Map<number, { self: SurvivalSelf; dirty: boolean; player: ServerPlayer }>
}

/** A Deadwood server keeping its saves in `store`, with what the tests need. */
async function server(store = new MemoryStore()) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const sent: { id: number; self: SurvivalSelf }[] = []
  let seq = 0
  const join = async (name: string, account?: string): Promise<ServerPlayer> => {
    if (account) await game.saves.loadCharacter(account)
    const box: { id: number } = { id: 0 }
    const id = game.join(name, {
      send: (bytes: Uint8Array) => {
        // Only the survival messages (0x90: JSON self) are of interest.
        if (bytes[0] !== 0x90) return
        const text = new TextDecoder().decode(bytes.subarray(3))
        sent.push({ id: box.id, self: JSON.parse(text) })
      },
      ...(account ? { account } : {}),
    })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    box.id = p.id
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
  /** Past the newcomer's shield (which would spare them), then dead at `killer`'s hands. */
  const kill = (p: ServerPlayer, killer: ServerPlayer = p) => {
    // Back on their feet first (after the last death).
    for (let i = 0; i < 30 * TICK_RATE && !p.state.alive; i++) game.step()
    sv(p).self.age = SHIELD_SECONDS + 1
    game.killPlayer(p.id, killer.id)
    run(0.2)
  }
  const zombie = () => {
    const z = [...game.players.values()].find((x) => x.zombie)
    if (!z) throw new Error('no zombie')
    return z
  }
  /** Stands in front of the obituary wall and presses E at it. */
  const flowers = (p: ServerPlayer) => {
    const wall = map.survival?.interactables.find((i) => i.kind === 'obituary')
    if (!wall) throw new Error('no wall')
    const [x, y, z] = wall.pos
    p.state.pos = { x: x - 1.6, y: y - 1.3 + 0.02, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    const dx = x - p.state.pos.x
    const yaw = Math.atan2(-dx, 0)
    const pitch = Math.atan2(y - (p.state.pos.y + 1.6), Math.abs(dx))
    for (const buttons of [0, Button.Use, 0]) {
      game.handleInput(p.id, [{ seq: ++seq, buttons, yaw, pitch, viewTick: game.tick }])
      game.step()
    }
  }
  return { game, director, sv, join, run, act, kill, zombie, flowers, sent, store }
}

describe('saves: the account record', () => {
  test('each feature keeps its own key; it outlives characters and new worlds', async () => {
    const store = new MemoryStore()
    const saves = new Saves(store)
    await saves.loadAccount('a1')
    expect(saves.account('a1')).toEqual({})
    saves.putAccount('a1', 'legacy', { lives: [1] })
    saves.putAccount('a1', 'notes', { done: 2 })
    saves.newWorld()
    await saves.flush()
    const again = new Saves(store)
    await again.loadCharacter('a1')
    expect(again.account('a1')).toEqual({ legacy: { lives: [1] }, notes: { done: 2 } })
    expect(again.account('nobody')).toEqual({})
  })
})

describe('legacy: how a life is counted', () => {
  test('kills, meals, bandages and crafting are counted on the character', async () => {
    const t = await server()
    const p = await t.join('Sam', 'acct')
    t.run(0.5)
    const z = t.zombie()
    t.game.killPlayer(z.id, p.id)
    t.run(0.1)
    expect(t.sv(p).self.life?.kills).toBe(1)
    // A crafted bandage, then using it.
    const self = t.sv(p).self
    self.inv = []
    self.pack = 'pack_military'
    give(self, 'rags', 3)
    t.act(p, { a: 'craft', recipe: 'bandage' })
    t.run(3.5)
    expect(self.life?.crafted).toBe(1)
    const bandage = self.inv.find((h) => h.item === 'bandage')
    if (!bandage) throw new Error('no bandage')
    t.act(p, { a: 'use', from: { c: bandage.c, x: bandage.x, y: bandage.y } })
    t.run(6)
    expect(self.life?.patched).toBe(1)
    give(self, 'beans', 1)
    const beans = self.inv.find((h) => h.item === 'beans')
    if (!beans) throw new Error('no beans')
    t.act(p, { a: 'use', from: { c: beans.c, x: beans.x, y: beans.y } })
    t.run(4)
    expect(self.life?.meals).toBe(1)
  })

  test('walking adds up; a jump across the map does not', async () => {
    const t = await server()
    const p = await t.join('Sam', 'acct')
    t.run(1.2)
    const before = t.sv(p).self.life?.walked ?? 0
    p.state.pos = { ...p.state.pos, x: p.state.pos.x + 3 }
    t.run(1)
    const walked = (t.sv(p).self.life?.walked ?? 0) - before
    expect(walked).toBeGreaterThan(2)
    expect(walked).toBeLessThan(5)
    p.state.pos = { ...p.state.pos, x: p.state.pos.x + 300 }
    t.run(1)
    expect((t.sv(p).self.life?.walked ?? 0) - before).toBeLessThan(5)
  })

  test('how they died, said plainly', () => {
    const fine = { bleeding: false, hunger: 50, thirst: 50 }
    const none = { turning: false, zombie: null, by: null }
    expect(causeOfDeath({ ...none, turning: true, zombie: ZombieKind.Walker }, fine)).toBe('Turned')
    expect(causeOfDeath({ ...none, zombie: ZombieKind.Brute }, fine)).toBe('Broken by a brute')
    expect(causeOfDeath({ ...none, zombie: ZombieKind.Walker }, fine)).toBe('Taken by the dead')
    expect(causeOfDeath({ ...none, by: 'Ada Crane' }, fine)).toBe('Killed by Ada Crane')
    expect(causeOfDeath(none, { ...fine, bleeding: true })).toBe('Bled out')
    expect(causeOfDeath(none, { ...fine, thirst: 0 })).toBe('Died of thirst')
    expect(causeOfDeath(none, { ...fine, hunger: 0 })).toBe('Starved')
    expect(causeOfDeath(none, fine)).toBe('Died alone')
  })
})

describe('legacy: death', () => {
  test('a death goes into the journal of past lives and onto the wall; the trait carries on', async () => {
    const t = await server()
    const p = await t.join('Sam', 'acct')
    t.run(0.5)
    const first = t.sv(p).self
    const name = first.bio?.name
    first.life = { ...freshLife(), kills: 45, nights: 2 }
    expect(first.trait).toBeNull()
    t.kill(p, t.zombie())
    const legacy = t.director.legacy.legacyOf(p)
    expect(legacy.lives).toHaveLength(1)
    expect(legacy.lives[0]).toMatchObject({ name, kills: 45, cause: 'Taken by the dead' })
    expect(legacy.lives[0]?.trait).toBe('steady')
    expect(legacy.traits).toEqual(['steady'])
    // Somebody new, carrying what the dead one left; their own life starts from nothing.
    const next = t.sv(p).self
    expect(next.bio?.name).toBeDefined()
    expect(next.trait).toBe('steady')
    expect(next.life?.kills ?? 0).toBe(0)
    // Everyone sees the name on the wall.
    expect(t.director.legacy.wall.dead[0]).toMatchObject({ name, kills: 45, flowers: 0 })
  })

  test('a life that earned nothing leaves nothing; the wall still remembers it', async () => {
    const t = await server()
    const p = await t.join('Sam', 'acct')
    t.run(0.5)
    t.kill(p)
    expect(t.director.legacy.legacyOf(p).lives[0]?.trait).toBeNull()
    expect(t.director.legacy.legacyOf(p).traits).toEqual([])
    expect(t.sv(p).self.trait).toBeNull()
    expect(t.director.legacy.wall.dead).toHaveLength(1)
  })

  test('guests are on the wall but keep no journal', async () => {
    const t = await server()
    const p = await t.join('Guest')
    t.run(0.5)
    t.kill(p)
    expect(t.director.legacy.legacyOf(p).lives).toEqual([])
    expect(t.director.legacy.wall.dead).toHaveLength(1)
  })

  test('the journal and traits are kept on the account through a restart', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    const p = await one.join('Sam', 'acct')
    one.run(0.5)
    one.sv(p).self.life = { ...freshLife(), crafted: 25 }
    one.kill(p)
    one.game.leave(p.id)
    await one.game.saves.flush()
    const two = await server(store)
    const q = await two.join('Sam', 'acct')
    expect(two.director.legacy.legacyOf(q).traits).toEqual(['handy'])
    expect(two.sv(q).self.trait).toBe('handy')
    expect(two.director.legacy.wall.dead).toHaveLength(1)
  })
})

describe('legacy: picking a trait', () => {
  test('only traits the account earned, only while the character is new', async () => {
    const t = await server()
    const p = await t.join('Sam', 'acct')
    t.run(0.5)
    t.sv(p).self.life = { ...freshLife(), kills: 50 }
    t.kill(p)
    t.sv(p).self.life = { ...freshLife(), nights: 9 }
    t.kill(p)
    expect(t.director.legacy.legacyOf(p).traits).toEqual(['nightowl', 'steady'])
    t.run(12)
    const self = t.sv(p).self
    expect(p.state.alive).toBe(true)
    expect(self.trait).toBe('nightowl')
    self.age = 10
    t.act(p, { a: 'trait', id: 'steady' })
    expect(self.trait).toBe('steady')
    // Not earned: ignored.
    t.act(p, { a: 'trait', id: 'handy' })
    expect(self.trait).toBe('steady')
    t.act(p, { a: 'trait', id: null })
    expect(self.trait).toBeNull()
    // Too late.
    self.age = PICK_SECONDS + 1
    t.act(p, { a: 'trait', id: 'steady' })
    expect(self.trait).toBeNull()
  })
})

describe('legacy: trait effects', () => {
  test('Handy makes crafting quicker; Iron Stomach slows hunger', async () => {
    const t = await server()
    const p = await t.join('Sam', 'acct')
    t.run(0.5)
    const self = t.sv(p).self
    const director = t.director as unknown as {
      workbench: { startCraft(w: unknown, id: string): void }
    }
    // Bandages from rags: 3 s plain.
    self.trait = 'handy'
    self.inv = []
    self.pack = 'pack_military'
    give(self, 'rags', 3)
    director.workbench.startCraft(t.sv(p), 'bandage')
    expect(self.busy?.secs).toBeCloseTo(3 * 0.9, 5)

    // Hunger over a minute, with and without.
    self.busy = null
    self.hunger = 100
    self.trait = null
    t.run(60)
    const plainDrop = 100 - self.hunger
    self.hunger = 100
    self.trait = 'stomach'
    t.run(60)
    const stomachDrop = 100 - self.hunger
    expect(stomachDrop).toBeLessThan(plainDrop)
    expect(stomachDrop).toBeGreaterThan(plainDrop * 0.85)
  })
})

describe('legacy: the obituary wall', () => {
  test('E leaves flowers for the newest name, once in a while; it is saved with the world', async () => {
    const store = new MemoryStore()
    const t = await server(store)
    const dead = await t.join('Gone', 'a1')
    const p = await t.join('Sam', 'a2')
    t.run(0.5)
    t.kill(dead)
    const name = t.director.legacy.wall.dead[0]?.name
    t.flowers(p)
    expect(t.director.legacy.wall.flowers).toBe(1)
    expect(t.director.legacy.wall.dead[0]?.flowers).toBe(1)
    // Again straight away: they just stand there.
    t.flowers(p)
    expect(t.director.legacy.wall.flowers).toBe(1)
    t.director.saveAll()
    await t.game.saves.flush()
    const two = await server(store)
    expect(two.director.legacy.wall.flowers).toBe(1)
    expect(two.director.legacy.wall.dead[0]?.name).toBe(name)
  })

  test('the wall goes out to players only when it changed', async () => {
    const t = await server()
    const p = await t.join('Sam', 'a2')
    t.run(0.5)
    const mine = () => t.sent.filter((m) => m.id === p.id)
    expect(mine().filter((m) => m.self.wall).length).toBe(1)
    expect(mine()[0]?.self.legacy).toEqual({ lives: [], traits: [] })
    const count = mine().length
    t.sv(p).dirty = true
    t.run(0.1)
    expect(mine().length).toBeGreaterThan(count)
    expect(mine().filter((m) => m.self.wall).length).toBe(1)
    const other = await t.join('Gone', 'a1')
    t.run(0.2)
    t.kill(other)
    expect(mine().filter((m) => m.self.wall).length).toBe(2)
    // What's sent is never what's saved.
    expect(t.sv(p).self.wall).toBeUndefined()
  })
})

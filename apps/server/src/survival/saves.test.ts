import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeClientMessage,
  encodeClientMessage,
  give,
  initPhysics,
  loadMap,
  mergeRules,
  PROTOCOL_VERSION,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { FileStore } from '../file-store.ts'
import { Game, type ServerPlayer } from '../game.ts'
import { accountOf } from '../identity.ts'
import { MemoryStore, type Migration, SAVE_VERSION, type SaveStore, upgrade } from '../saves.ts'
import { createSession } from '../session.ts'
import type { SurvivalDirector } from './director.ts'

beforeAll(async () => {
  await initPhysics()
})

const NO_SEND = { send: () => {} }

/** A Deadwood server (survival) keeping its saves in `store`. */
async function server(store: SaveStore) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as {
    survivors: Map<number, { self: SurvivalSelf }>
    found: Set<number>
    gates: number
  }
  /** Someone joins (as the session does: their character is read first). */
  const join = async (name: string, account?: string): Promise<ServerPlayer> => {
    if (account) await game.saves.loadCharacter(account)
    const id = game.join(name, { ...NO_SEND, ...(account ? { account } : {}) })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  const self = (p: ServerPlayer): SurvivalSelf => {
    const sv = insides.survivors.get(p.id)
    if (!sv) throw new Error('not a survivor')
    return sv.self
  }
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  /** Leaves and waits for the save to be written. */
  const leave = async (p: ServerPlayer) => {
    game.leave(p.id)
    await game.saves.flush()
  }
  return { game, director, insides, join, self, run, leave }
}

const beans = (self: SurvivalSelf) =>
  self.inv.filter((s) => s.item === 'beans').reduce((n, s) => n + s.n, 0)

describe('saves: accounts', () => {
  test('a token gives a stable account that is not the token; junk gives none', async () => {
    const token = '0123456789abcdef0123456789abcdef'
    const account = await accountOf(token)
    expect(account).toMatch(/^[0-9a-f]{32}$/)
    expect(account).not.toBe(token)
    expect(await accountOf(token)).toBe(account)
    expect(await accountOf('ffffffffffffffffffffffffffffffff')).not.toBe(account)
    for (const bad of [undefined, '', 'Sam', 'zz'.repeat(16), `${token}0`])
      expect(await accountOf(bad)).toBeNull()
  })

  test('Hello carries the token; the session joins under its account', async () => {
    const token = 'a'.repeat(32)
    const hello = {
      type: ClientMsg.Hello,
      protocolVersion: PROTOCOL_VERSION,
      name: 'Sam',
      token,
    } as const
    expect(decodeClientMessage(encodeClientMessage(hello))).toEqual(hello)
    const t = await server(new MemoryStore())
    const session = createSession(t.game, { send: () => {}, close: () => {} }, () => 0)
    session.message(encodeClientMessage(hello))
    for (let i = 0; i < 20 && !session.playerId; i++) await Bun.sleep(5)
    const p = t.game.players.get(session.playerId)
    expect(p?.account).toBe((await accountOf(token)) ?? 'none')
    // A second tab on the same account plays as a guest (nothing of theirs is kept twice).
    const again = createSession(t.game, { send: () => {}, close: () => {} }, () => 0)
    again.message(encodeClientMessage(hello))
    for (let i = 0; i < 20 && !again.playerId; i++) await Bun.sleep(5)
    expect(again.playerId).not.toBe(0)
    expect(t.game.players.get(again.playerId)?.account).toBeUndefined()
  })

  test("two players with the same name don't share gear; the same account gets it back", async () => {
    const t = await server(new MemoryStore())
    const a = await t.join('Sam', 'aaaa')
    give(t.self(a), 'beans', 2)
    t.self(a).money = 321
    await t.leave(a)
    // Somebody else types the same name: a stranger with a stranger's pockets.
    const b = await t.join('Sam', 'bbbb')
    expect(beans(t.self(b))).toBe(0)
    expect(t.self(b).money).not.toBe(321)
    await t.leave(b)
    // A guest (no account) called Sam gets nothing either.
    const guest = await t.join('Sam')
    expect(beans(t.self(guest))).toBe(0)
    t.game.leave(guest.id)
    // The real Sam comes back, under any name.
    const back = await t.join('Samuel', 'aaaa')
    expect(beans(t.self(back))).toBe(2)
    expect(t.self(back).money).toBe(321)
  })
})

describe('saves: characters', () => {
  test('survives a restart: backpack, needs, infection, journal, weapons and where you stood', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    const p = await one.join('Sam', 'acct')
    one.run(0.5)
    const s = one.self(p)
    give(s, 'beans', 2)
    s.wear.body = 'policevest'
    s.money = 77
    s.hunger = 33
    s.infected = 500
    s.journal.notes.push('motel_note')
    p.health = 64
    const at = { x: p.state.pos.x + 4, y: p.state.pos.y, z: p.state.pos.z + 2 }
    p.state.pos = { ...at }
    await one.leave(p)

    // A brand-new server on the same store.
    const two = await server(store)
    const q = await two.join('Sam', 'acct')
    const r = two.self(q)
    expect(beans(r)).toBe(2)
    expect(r.wear.body).toBe('policevest')
    expect(r.money).toBe(77)
    expect(r.hunger).toBe(33)
    expect(r.infected).toBe(500)
    expect(r.journal.notes).toContain('motel_note')
    expect(q.health).toBe(64)
    expect(Math.hypot(q.state.pos.x - at.x, q.state.pos.z - at.z)).toBeLessThan(0.1)
  })

  test('players still connected are saved periodically (a crash loses at most that)', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    const p = await one.join('Sam', 'acct')
    give(one.self(p), 'beans', 2)
    one.self(p).money = 404
    // What the director does every SAVE_SECONDS (and the Bun server on shutdown).
    await one.game.saveAll()
    const two = await server(store)
    const s = two.self(await two.join('Sam', 'acct'))
    expect(beans(s)).toBe(2)
    expect(s.money).toBe(404)
  })

  test('dying is saved at once: you come back as somebody new, at Haven', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    const p = await one.join('Sam', 'acct')
    one.run(0.5)
    give(one.self(p), 'beans', 2)
    one.self(p).infected = 2
    one.run(3.5)
    expect(p.state.alive).toBe(false)
    await one.game.saves.flush()
    // The tab closes before they wake.
    const two = await server(store)
    const q = await two.join('Sam', 'acct')
    expect(beans(two.self(q))).toBe(0)
    expect(two.self(q).infected).toBeNull()
    const haven = two.game.world.map.survival?.pois.find((x) => x.key === 'haven')
    if (!haven) throw new Error('no haven')
    expect(Math.hypot(q.state.pos.x - haven.x, q.state.pos.z - haven.z)).toBeLessThan(haven.r)
  })

  test('saved things that no longer exist are dropped, not crashed on', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    await one.leave(await one.join('Sam', 'acct'))
    const saved = (await store.get('char:acct')) as { data: { self: SurvivalSelf } }
    saved.data.self.inv.push({ item: 'no_such_thing', n: 1, c: 'pockets', x: 0, y: 0 } as never)
    saved.data.self.wear.head = 'gone_hat'
    await store.put('char:acct', saved)
    const two = await server(store)
    const s = two.self(await two.join('Sam', 'acct'))
    expect(s.inv.some((h) => h.item === 'no_such_thing')).toBe(false)
    expect(s.wear.head).toBeUndefined()
  })
})

describe('saves: the world', () => {
  test('unlocks, finished quests, Nell, found places and gates survive a restart', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    one.director.story.restore(['wake'], ['radio', 'nell', 'workshop'])
    const motel = one.game.world.map.survival?.pois.findIndex((x) => x.key === 'motel') ?? -1
    expect(motel).toBeGreaterThanOrEqual(0)
    one.insides.found.add(motel)
    one.insides.gates |= 2
    // Saved within WORLD_SAVE_SECONDS of changing.
    one.run(5.1)
    await one.game.saves.flush()

    const two = await server(store)
    expect(two.director.story.unlocks).toEqual(['radio', 'nell', 'workshop'])
    expect(two.director.story.done).toEqual(['wake'])
    expect(two.director.story.talkables().some((w) => w.key === 'nell')).toBe(true)
    expect(two.insides.found.has(motel)).toBe(true)
    expect(two.insides.gates & 2).toBe(2)
  })

  test('a new world (the story ends) starts the world and every character over', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    one.director.story.restore([], ['radio'])
    const p = await one.join('Sam', 'acct')
    give(one.self(p), 'beans', 2)
    await one.game.saveAll()
    const epoch = one.game.saves.world.epoch
    // What a finished story leads to: a new round, a new night.
    one.director.start()
    await one.game.saves.flush()
    expect(one.game.saves.world.epoch).toBe(epoch + 1)
    expect(beans(one.self(p))).toBe(0)

    const two = await server(store)
    expect(two.director.story.unlocks).toEqual([])
    const q = await two.join('Sam', 'acct')
    expect(beans(two.self(q))).toBe(0)
  })
})

describe('saves: schema', () => {
  test('older saves are brought up to date by the migration steps', () => {
    const steps: Record<number, Migration> = {
      1: (_kind, d) => ({ ...d, coins: undefined, money: d.coins }),
      2: (kind, d) => (kind === 'character' ? { ...d, reborn: d.reborn ?? false } : d),
    }
    const old = { v: 1, data: { coins: 12 } }
    expect(upgrade(old, 'character', steps, 3)).toEqual({
      coins: undefined,
      money: 12,
      reborn: false,
    })
    // Up to date: unchanged. A step missing, or a save from a newer server: not loaded.
    expect(upgrade({ v: 3, data: { a: 1 } }, 'world', steps, 3)).toEqual({ a: 1 })
    expect(upgrade({ v: 1, data: {} }, 'world', { 2: steps[2] as Migration }, 3)).toBeNull()
    expect(upgrade({ v: SAVE_VERSION + 1, data: {} }, 'world')).toBeNull()
    expect(upgrade('junk', 'world')).toBeNull()
  })

  test('the file store keeps saves across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'office-saves-'))
    try {
      const one = await server(new FileStore(dir))
      const p = await one.join('Sam', 'acct')
      give(one.self(p), 'beans', 2)
      one.self(p).money = 505
      await one.leave(p)
      const two = await server(new FileStore(dir))
      const s = two.self(await two.join('Sam', 'acct'))
      expect(beans(s)).toBe(2)
      expect(s.money).toBe(505)
      expect(await new FileStore(dir).get('nothing')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

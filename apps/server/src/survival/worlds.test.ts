import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_RULES,
  encodeClientMessage,
  give,
  initPhysics,
  loadMap,
  mergeRules,
  PROTOCOL_VERSION,
  type SurvivalSelf,
  seeded,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { accountOf } from '../identity.ts'
import {
  type CharacterSave,
  characterKey,
  LIVE_MS,
  MemoryStore,
  SAVE_VERSION,
  type SaveStore,
  Saves,
  worldKey,
} from '../saves.ts'
import { createSession } from '../session.ts'
import { WorldHost } from '../world-host.ts'
import type { SurvivalDirector } from './director.ts'

beforeAll(async () => {
  await initPhysics()
})

/** A character as the director would put it (only what these tests look at matters). */
const character = (name: string): Omit<CharacterSave, 'epoch'> =>
  ({
    name,
    self: {} as SurvivalSelf,
    kit: [],
    reborn: false,
    waiting: [],
    health: 100,
    locker: [],
    pos: { x: 1, y: 2, z: 3, yaw: 0 },
  }) as Omit<CharacterSave, 'epoch'>

describe('saves: keys per world', () => {
  test('the original world keeps the old key; others and characters get their own', () => {
    expect(worldKey('deadwood-1')).toBe('world')
    expect(worldKey('deadwood-2')).toBe('world:deadwood-2')
    expect(worldKey('p-abcd2345')).toBe('world:p-abcd2345')
    // Characters belong to the account: no world in the key.
    expect(characterKey('acct')).toBe('char:acct')
  })

  test('worlds keep their own progress; a save from before worlds lands in Deadwood 1', async () => {
    const store = new MemoryStore()
    await store.put('world', { v: SAVE_VERSION, data: { epoch: 0, found: ['haven'], gates: 1 } })
    const one = new Saves(store, 'deadwood-1')
    const two = new Saves(store, 'deadwood-2')
    await one.loadWorld()
    await two.loadWorld()
    expect(one.world.found).toEqual(['haven'])
    expect(two.world.found).toEqual([])
    two.putWorld({ ...two.world, found: ['mill'], gates: 4 })
    await two.flush()
    expect(store.data.has('world:deadwood-2')).toBe(true)
    const again = new Saves(store, 'deadwood-1')
    await again.loadWorld()
    expect(again.world.found).toEqual(['haven']) // untouched by world 2
  })
})

describe('saves: one character, any world', () => {
  test('a character saved in one world loads in another (waking at Haven there)', async () => {
    const store = new MemoryStore()
    const one = new Saves(store, 'deadwood-1')
    await one.loadWorld()
    one.putCharacter('acct', character('Sam'))
    await one.flush()
    const two = new Saves(store, 'deadwood-2')
    await two.loadWorld()
    await two.loadCharacter('acct')
    const there = two.character('acct')
    expect(there?.name).toBe('Sam')
    expect(there?.pos).toBeUndefined()
    // Back in the world they left, they stand where they were.
    await one.loadCharacter('acct')
    expect(one.character('acct')?.pos).toEqual({ x: 1, y: 2, z: 3, yaw: 0 })
  })

  test('a world reads the character afresh: what happened in the other world counts', async () => {
    const store = new MemoryStore()
    const one = new Saves(store, 'deadwood-1')
    const two = new Saves(store, 'deadwood-2')
    await one.loadWorld()
    await two.loadWorld()
    one.putCharacter('acct', character('Sam'))
    await one.flush()
    await two.loadCharacter('acct')
    two.putCharacter('acct', { ...character('Sam'), health: 40 })
    await two.flush()
    // World 1 still has the old copy in memory: it must not be the one that loads.
    await one.loadCharacter('acct')
    expect(one.character('acct')?.health).toBe(40)
  })

  test("a world's reset starts over its own people, not those who last played elsewhere", async () => {
    const store = new MemoryStore()
    const one = new Saves(store, 'deadwood-1')
    const two = new Saves(store, 'deadwood-2')
    await one.loadWorld()
    await two.loadWorld()
    one.putCharacter('here', character('Ann'))
    two.putCharacter('away', character('Bo'))
    await one.flush()
    await two.flush()
    one.newWorld()
    await one.flush()
    const after = new Saves(store, 'deadwood-1')
    await after.loadWorld()
    await after.loadCharacter('here')
    await after.loadCharacter('away')
    expect(after.character('here')).toBeUndefined()
    expect(after.character('away')?.name).toBe('Bo')
  })

  test('playing in one world: another world sees them as busy until they leave', async () => {
    const now = 1_000_000
    const store = new MemoryStore()
    const one = new Saves(store, 'deadwood-1', () => now)
    const two = new Saves(store, 'deadwood-2', () => now)
    await one.loadWorld()
    await two.loadWorld()
    one.putCharacter('acct', character('Sam'))
    await one.flush()
    one.claim('acct')
    await one.flush()
    await two.loadCharacter('acct')
    expect(two.busyElsewhere('acct')).toBe(true)
    expect(one.busyElsewhere('acct')).toBe(false) // not elsewhere: here
    // Saves while they play keep the claim fresh; leaving clears it.
    one.putCharacter('acct', character('Sam'))
    await one.flush()
    expect((store.data.get('char:acct') ?? '').includes('"live":"deadwood-1"')).toBe(true)
    one.release('acct')
    one.putCharacter('acct', character('Sam'))
    await one.flush()
    await two.loadCharacter('acct')
    expect(two.busyElsewhere('acct')).toBe(false)
  })

  test("a crashed room's claim runs out", async () => {
    let now = 5_000_000
    const store = new MemoryStore()
    const one = new Saves(store, 'deadwood-1', () => now)
    const two = new Saves(store, 'deadwood-2', () => now)
    await one.loadWorld()
    one.putCharacter('acct', character('Sam'))
    one.claim('acct')
    await one.flush()
    now += LIVE_MS + 1
    await two.loadCharacter('acct')
    expect(two.busyElsewhere('acct')).toBe(false)
  })
})

/** A Deadwood world in a shared store (as the Bun server and the Cloudflare rooms run them). */
async function world(store: SaveStore, id: string) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store, id)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const survivors = (director as unknown as { survivors: Map<number, { self: SurvivalSelf }> })
    .survivors
  const self = (p: ServerPlayer) => survivors.get(p.id)?.self as SurvivalSelf
  return { game, self }
}

const beans = (self: SurvivalSelf) =>
  self.inv.filter((s) => s.item === 'beans').reduce((n, s) => n + s.n, 0)

/** Joins through a real session (Hello with a token), as a browser would. */
async function connect(game: Game, token: string) {
  const session = createSession(game, { send: () => {}, close: () => {} }, () => 0)
  session.message(
    encodeClientMessage({
      type: ClientMsg.Hello,
      protocolVersion: PROTOCOL_VERSION,
      name: 'Sam',
      token,
    }),
  )
  for (let i = 0; i < 40 && !session.playerId; i++) await Bun.sleep(5)
  const player = game.players.get(session.playerId)
  if (!player) throw new Error('did not join')
  return { session, player }
}

describe('worlds: the same survivor in two worlds', () => {
  test('carries their backpack across; one body at a time', async () => {
    const store = new MemoryStore()
    const one = await world(store, 'deadwood-1')
    const two = await world(store, 'deadwood-2')
    const token = 'c'.repeat(32)
    const account = await accountOf(token)

    const a = await connect(one.game, token)
    expect(a.player.account).toBe(account ?? 'none')
    give(one.self(a.player), 'beans', 2)
    const carried = beans(one.self(a.player))
    expect(carried).toBeGreaterThan(0)
    one.game.match.saveAll()
    await one.game.saves.flush()

    // A second tab in world 2 while they're still in world 1: a guest there.
    const b = await connect(two.game, token)
    expect(b.player.account).toBeUndefined()
    b.session.close(1000)

    // They leave world 1 and walk into world 2: same character, same beans.
    a.session.close(1000)
    await one.game.saves.flush()
    const c = await connect(two.game, token)
    expect(c.player.account).toBe(account ?? 'none')
    expect(beans(two.self(c.player))).toBe(carried)
    c.session.close(1000)
  })
})

describe('WorldHost (Bun server)', () => {
  const fake = (people: number, zombies = 0) => {
    const players = new Map<number, Partial<ServerPlayer>>()
    for (let i = 0; i < people; i++) players.set(i, {})
    for (let i = 0; i < zombies; i++) players.set(100 + i, { zombie: {} as never })
    return { game: { players } as unknown as Game }
  }

  test('opens each world once and counts people, not the dead', async () => {
    let opened = 0
    const sizes: Record<string, number> = { 'deadwood-1': 2, 'deadwood-2': 5 }
    const host = new WorldHost(async (id) => {
      opened++
      return fake(sizes[id] ?? 0, 10)
    })
    await Promise.all([host.get('deadwood-1'), host.get('deadwood-1'), host.get('deadwood-2')])
    expect(opened).toBe(2)
    const reply = host.reply()
    expect(reply.worlds.map((w) => w.players)).toEqual([2, 5, 0])
    expect(reply.pick).toBe('deadwood-2')
  })

  test('routes ?world=, and maps without worlds always go to the original', () => {
    const multi = new WorldHost(async () => fake(0))
    expect(multi.route('deadwood-2')).toBe('deadwood-2')
    expect(multi.route('p-abcd2345')).toBe('p-abcd2345')
    expect(multi.route('bogus')).toBe('deadwood-1')
    const single = new WorldHost(async () => fake(0), false)
    expect(single.route('deadwood-2')).toBe('deadwood-1')
  })
})

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  bioDeathLine,
  createPhysicsWorld,
  DEFAULT_APPEARANCE,
  DEFAULT_RULES,
  decodeServerMessage,
  give,
  initPhysics,
  loadMap,
  mergeRules,
  openJobs,
  packAppearance,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  ZombieKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import {
  drainFactor,
  gentleCount,
  gentleKind,
  inShield,
  KEEP_LOOT_SECONDS,
  keepsLoot,
  SHIELD_RADIUS,
  SHIELD_SECONDS,
  shielded,
  startPoi,
} from './newcomer.ts'

beforeAll(async () => {
  await initPhysics()
})

interface Inside {
  survivors: Map<number, { player: ServerPlayer; self: SurvivalSelf }>
  zeds: Map<number, { kind: number }>
}

function setup(o: { body?: number; seed?: number } = {}) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(o.seed ?? 5))
  const inbox: ServerMessage[] = []
  const client = { send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }
  const look = packAppearance({ ...DEFAULT_APPEARANCE, body: o.body ?? 0 })
  const id = game.join('P0', client, undefined, undefined, look) ?? 0
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const inside = (game.match as unknown as { survival: Inside }).survival
  const sv = () => {
    const s = inside.survivors.get(id)
    if (!s) throw new Error('no survivor')
    return s
  }
  const last = <T extends ServerMessage['type']>(type: T) =>
    inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1)
  const run = (seconds: number) => {
    for (let k = 0; k < seconds * TICK_RATE; k++) game.step()
  }
  let seq = 1
  const useAt = (x: number, y: number, z: number) => {
    const s = sv().player.state
    const dx = x - s.pos.x
    const dz = z - s.pos.z
    const yaw = Math.atan2(-dx, -dz)
    const pitch = Math.atan2(y - (s.pos.y + 1.6), Math.hypot(dx, dz))
    for (const buttons of [0, Button.Use, 0]) {
      game.handleInput(id, [{ seq: ++seq, buttons, yaw, pitch, viewTick: game.tick }])
      game.step()
    }
  }
  const move = (x: number, y: number, z: number) => {
    const p = sv().player
    p.state.pos = { x, y, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = Number.POSITIVE_INFINITY
  }
  const answer = (npc: string, option: string) =>
    game.handleAction(id, { a: 'choose', npc, option })
  return { game, def, inside, id, sv, last, run, useAt, move, answer }
}

const beans = (self: SurvivalSelf) =>
  self.inv.filter((h) => h.item === 'beans').reduce((n, h) => n + h.n, 0)

describe('newcomer: the rules', () => {
  test('one in-game day of slower needs; ten minutes of dying for free; old saves are no one new', () => {
    expect(shielded(0)).toBe(true)
    expect(shielded(SHIELD_SECONDS - 1)).toBe(true)
    expect(shielded(SHIELD_SECONDS)).toBe(false)
    expect(shielded(undefined)).toBe(false)
    expect(drainFactor(10)).toBe(0.5)
    expect(drainFactor(SHIELD_SECONDS)).toBe(1)
    expect(keepsLoot(KEEP_LOOT_SECONDS - 1)).toBe(true)
    expect(keepsLoot(KEEP_LOOT_SECONDS)).toBe(false)
    expect(keepsLoot(undefined)).toBe(false)
  })

  test('the gentle woods: only walkers, half as many, within reach of the cabin', () => {
    for (const kind of Object.values(ZombieKind)) expect(gentleKind(kind)).toBe(ZombieKind.Walker)
    expect(gentleCount(5)).toBe(2)
    expect(gentleCount(1)).toBe(0)
    expect(gentleCount(-3)).toBe(0)
    const def = loadMap('deadwood').survival
    const cabin = def && startPoi(def.pois)
    if (!def || !cabin) throw new Error('no cabin')
    expect(inShield(def.pois, cabin)).toBe(true)
    expect(inShield(def.pois, { x: cabin.x + SHIELD_RADIUS + 1, z: cabin.z })).toBe(false)
  })
})

describe('newcomer: in the game', () => {
  test('a new character has a past, of the build they chose, and an age that counts up', () => {
    const t = setup({ body: 1 })
    t.run(2)
    const self = t.last(ServerMsg.Survival)?.self
    expect(self?.bio?.body).toBe(1)
    expect(self?.bio?.name).toMatch(/^\S+ \S+$/)
    if (self?.bio) expect(bioDeathLine(self.bio)).toBe('This is how she died.')
    expect(t.sv().self.age).toBeGreaterThanOrEqual(1)
  })

  test('hunger and thirst drain half as fast for somebody new', () => {
    const drop = (veteran: boolean) => {
      const t = setup()
      t.run(0.5)
      if (veteran) t.sv().self.age = SHIELD_SECONDS
      const { hunger, thirst } = t.sv().self
      t.run(60)
      return [hunger - t.sv().self.hunger, thirst - t.sv().self.thirst] as const
    }
    const fresh = drop(false)
    const old = drop(true)
    expect(fresh[0]).toBeCloseTo(old[0] / 2, 3)
    expect(fresh[1]).toBeCloseTo(old[1] / 2, 3)
    expect(old[0]).toBeGreaterThan(0)
  })

  test('dying in the first ten minutes: you wake where you started, the same person, with it all', () => {
    const t = setup()
    t.run(1)
    const sv = t.sv()
    give(sv.self, 'beans', 2)
    const had = beans(sv.self)
    expect(had).toBe(2)
    sv.self.money = 90
    sv.self.infected = 300
    const name = sv.self.bio?.name
    const start = t.game.world.map.spawns[0]?.pos
    if (!start) throw new Error('no spawn')
    t.move(start[0] + 40, start[1] + 5, start[2] + 40)
    t.game.killPlayer(t.id, t.id)
    t.run(7)
    expect(sv.player.state.alive).toBe(true)
    expect(beans(sv.self)).toBe(had)
    expect(sv.self.money).toBe(90)
    expect(sv.self.infected).toBeNull()
    expect(sv.self.bio?.name).toBe(name)
    expect(sv.self.journal.quests.some((q) => q.id === 'wake')).toBe(true)
    const p = sv.player.state.pos
    expect(Math.hypot(p.x - start[0], p.z - start[2])).toBeLessThan(3)
    // Past ten minutes it costs everything, and somebody new takes over.
    sv.self.age = KEEP_LOOT_SECONDS
    t.game.killPlayer(t.id, t.id)
    t.run(0.2)
    expect(beans(sv.self)).toBe(0)
    expect(sv.self.age).toBe(0)
    expect(sv.self.bio?.seed).toBeGreaterThan(0)
  })

  test('at night by the cabin, somebody new meets fewer of the dead, and only walkers', () => {
    const near = (veteran: boolean) => {
      const t = setup({ seed: 9 })
      t.run(0.2)
      if (veteran) t.sv().self.age = SHIELD_SECONDS
      t.run(8)
      const cabin = startPoi(t.def.pois)
      if (!cabin) throw new Error('no cabin')
      return [...t.game.players.values()]
        .filter((p) => p.zombie && p.state.alive)
        .filter((p) => Math.hypot(p.state.pos.x - cabin.x, p.state.pos.z - cabin.z) < SHIELD_RADIUS)
        .map((p) => t.inside.zeds.get(p.id)?.kind)
    }
    const fresh = near(false)
    const old = near(true)
    expect(fresh.length).toBeLessThan(old.length)
    expect(fresh.length).toBeLessThanOrEqual(3)
    for (const kind of fresh) expect(kind).toBe(ZombieKind.Walker)
  })
})

describe("Haven's job board", () => {
  const atBoard = (t: ReturnType<typeof setup>) => {
    const board = t.def.interactables.find((i) => i.kind === 'board')
    if (!board) throw new Error('no job board')
    t.move(board.pos[0] + 1.6, board.pos[1] - 1.3, board.pos[2])
    t.useAt(...board.pos)
    return t.last(ServerMsg.Dialog)?.dialog
  }

  test('E lists the side jobs open to you; taking one starts it, and it leaves the board', () => {
    const t = setup()
    t.run(1)
    t.sv().self.journal.done.push('wake', 'keep')
    const open = openJobs(t.sv().self.journal).map((d) => d.id)
    expect(open.length).toBeGreaterThan(1)
    const shown = atBoard(t)
    expect(shown?.npc).toBe('board')
    const jobs = shown?.options.filter((o) => o.id.startsWith('job:')).map((o) => o.id.slice(4))
    expect(jobs).toEqual(open.slice(0, 8))
    // Story chapters are never on it.
    expect(jobs).not.toContain('gate')
    const pick = jobs?.[0] ?? ''
    t.answer('board', `job:${pick}`)
    expect(t.sv().self.journal.quests.some((q) => q.id === pick)).toBe(true)
    const again = t.last(ServerMsg.Dialog)?.dialog
    expect(again?.options.some((o) => o.id === `job:${pick}`)).toBe(false)
    // Taking it twice, or something not on the board, does nothing.
    const before = t.sv().self.journal.quests.length
    t.answer('board', `job:${pick}`)
    t.answer('board', 'job:gate')
    t.answer('board', 'job:nope')
    expect(t.sv().self.journal.quests.length).toBe(before)
  })

  test('from across the camp the board takes no answers', () => {
    const t = setup()
    t.run(1)
    t.sv().self.journal.done.push('wake', 'keep')
    const shown = atBoard(t)
    const job = shown?.options.find((o) => o.id.startsWith('job:'))?.id ?? ''
    const p = t.sv().player.state.pos
    t.move(p.x + 30, p.y, p.z)
    t.answer('board', job)
    expect(t.sv().self.journal.quests.some((q) => `job:${q.id}` === job)).toBe(false)
  })

  test('with every job done, the board says so', () => {
    const t = setup()
    t.run(1)
    const j = t.sv().self.journal
    j.done.push(...openJobs({ quests: [], done: [] }).map((d) => d.id))
    for (let k = 0; k < 6; k++) j.done.push(...openJobs(j).map((d) => d.id))
    const shown = atBoard(t)
    expect(shown?.options.map((o) => o.id)).toEqual(['bye'])
  })
})

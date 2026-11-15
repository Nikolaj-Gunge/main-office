import { beforeAll, describe, expect, test } from 'bun:test'
import {
  CHAT_MAX,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  give,
  heightAt,
  initPhysics,
  loadMap,
  mergeRules,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  ZombieKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore, type SaveStore } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import type { Zed } from './horde.ts'
import {
  distort,
  GRAB_DAMAGE,
  HELD_SPEED,
  lairAt,
  MIMIC_HEARD,
  MIMIC_MAX,
  MIMIC_NAME,
} from './lurkers.ts'
import { SHIELD_SECONDS } from './newcomer.ts'

beforeAll(async () => {
  await initPhysics()
})

type Insides = {
  survivors: Map<number, { self: SurvivalSelf }>
  zeds: Map<number, Zed>
  turned: Map<number, { stuff: { item: string; n: number }[]; look: number }>
  vehicles: { hideouts(): { x: number; y: number; z: number; yaw: number }[] }
  phase: string
  pool: ServerPlayer[]
}

/** A Deadwood server (survival), with its saves in `store`, and someone playing (P0). */
async function server(store: SaveStore = new MemoryStore()) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const inbox: ServerMessage[] = []
  const id = game.join('P0', { send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) })
  const player = game.players.get(id ?? -1)
  if (!player) throw new Error('no player')
  const sv = () => {
    const s = insides.survivors.get(player.id)
    if (!s) throw new Error('no survivor')
    return s
  }
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  /** P0 stands here (on the ground), past the newcomer's shield and open to harm. */
  const move = (x: number, z: number, yaw = 0) => {
    player.state.pos = { x, y: heightAt(def.terrain, x, z) + 0.05, z }
    player.state.vel = { x: 0, y: 0, z: 0 }
    player.state.yaw = yaw
    player.protectedUntil = 0
  }
  return { game, director, insides, def, inbox, player, sv, run, move }
}

describe('lurkers: what a mimic says', () => {
  test('said back lower case, caught on, trailing off, never longer than a chat line', () => {
    const r = seeded(3)
    for (const line of ['Help, over here!', 'Anyone got bandages?', 'x'.repeat(CHAT_MAX)]) {
      const out = distort(line, r)
      expect(out.endsWith('…')).toBe(true)
      expect(out.length).toBeLessThanOrEqual(CHAT_MAX)
      expect(out).toBe(out.toLowerCase())
    }
    expect(distort('Help, over here!', () => 0.9)).toBe('help, over here…')
    expect(distort('Help me', () => 0)).toBe('h-help m-me…')
  })

  test('about a third of the cars hide something, and which ones changes with the epoch', () => {
    const cars = Array.from({ length: 400 }, (_, i) => i)
    const share = cars.filter((i) => lairAt(i, 0, 0.3)).length / cars.length
    expect(share).toBeGreaterThan(0.22)
    expect(share).toBeLessThan(0.38)
    expect(cars.map((i) => lairAt(i, 1, 0.3))).not.toEqual(cars.map((i) => lairAt(i, 0, 0.3)))
  })
})

describe('lurkers: crawlers under cars', () => {
  test('walk up to the car and it has your ankle: held, hurt, then it crawls out after you', async () => {
    const t = await server()
    t.run(0.5)
    t.sv().self.age = SHIELD_SECONDS
    const cars = t.insides.vehicles.hideouts()
    const i = cars.findIndex((_, n) => lairAt(n, 0, 0.3))
    const car = cars[i]
    if (!car) throw new Error('no car with something under it')
    // Coming up the road, 40 m off: one is put under it (nobody sees that).
    t.move(car.x + 40, car.z)
    t.run(1.2)
    const lurking = [...t.insides.zeds.entries()].filter(([, z]) => z.lurking)
    expect(lurking.length).toBe(1)
    const [zid, zed] = lurking[0] as [number, Zed]
    const crawler = t.game.players.get(zid) as ServerPlayer
    expect(Math.hypot(crawler.state.pos.x - car.x, crawler.state.pos.z - car.z)).toBeLessThan(2)
    expect(zed.mood).toBe('dead')
    // Still out of reach: nothing.
    t.move(crawler.state.pos.x + 3, crawler.state.pos.z)
    t.run(0.5)
    expect(zed.lurking).toBe(true)
    // Right by it.
    t.player.health = t.player.maxHealth
    const before = t.player.health
    t.move(crawler.state.pos.x + 1, crawler.state.pos.z)
    t.run(0.1)
    expect(zed.lurking).toBe(false)
    expect(t.player.health).toBe(before - GRAB_DAMAGE)
    expect(t.game.match.speedFactor(t.player)).toBe(HELD_SPEED)
    const told = t.inbox.some(
      (m) => m.type === ServerMsg.Notice && m.notice.text.includes('has your ankle'),
    )
    expect(told).toBe(true)
    // A second later it lets go and comes after you on its belly.
    t.run(1.2)
    expect(t.game.match.speedFactor(t.player)).toBe(1)
    expect(zed.crawler).toBe(true)
    expect(zed.mood).toBe('chase')
    expect(zed.targetId).toBe(t.player.id)
  })
})

describe('lurkers: mimics', () => {
  test('repeats what was said near it, from an unknown voice; a torch sends it running', async () => {
    const t = await server()
    t.run(0.5)
    expect(t.insides.phase).toBe('night')
    t.sv().self.age = SHIELD_SECONDS
    const at = t.def.zombieSpots[0]?.pos ?? [0, 0, 0]
    const x = at[0] + 300
    const z = at[2] + 300
    t.move(x, z)
    t.game.handleSocial(t.player.id, { kind: 'chat', text: 'Help, over here!', channel: 'nearby' })
    const mimic = t.director.lurkers.spawnMimic({
      x,
      y: heightAt(t.def.terrain, x, z - 20),
      z: z - 20,
    })
    if (!mimic) throw new Error('no mimic')
    expect(mimic.zombie?.kind).toBe(ZombieKind.Mimic)
    expect(t.director.lurkers.mimicCount).toBe(1)
    t.move(x, z, Math.PI) // facing away, torch off
    t.run(6)
    const said = t.inbox
      .filter((m) => m.type === ServerMsg.Social)
      .map((m) => m.social)
      .find((s) => s.kind === 'chat' && s.from === mimic.id)
    if (said?.kind !== 'chat') throw new Error('it said nothing')
    expect(said.name).toBe(MIMIC_NAME)
    expect(said.channel).toBe('nearby')
    expect(said.text).toContain('over')
    expect(said.text.endsWith('…')).toBe(true)
    // Torch on, full in its face: off it goes into the dark.
    const zed = t.insides.zeds.get(mimic.id) as Zed
    // (Put it back 12 m off, in the open, whatever it did meanwhile.)
    mimic.state.pos = { x, y: heightAt(t.def.terrain, x, z - 12) + 0.05, z: z - 12 }
    const m = mimic.state.pos
    t.sv().self.light = true
    t.move(x, z, Math.atan2(-(m.x - x), -(m.z - z)))
    const was = Math.hypot(m.x - x, m.z - z)
    t.run(0.2)
    expect(zed.fleeing).toBe(true)
    t.run(3)
    expect(Math.hypot(mimic.state.pos.x - x, mimic.state.pos.z - z)).toBeGreaterThan(was + 3)
  })

  test('only what was said within earshot of it: otherwise the usual cries', async () => {
    const t = await server()
    t.run(0.2)
    t.move(100, 100)
    t.game.handleSocial(t.player.id, { kind: 'chat', text: 'secret plan', channel: 'nearby' })
    // Shouting to everyone isn't saying it out loud nearby.
    t.game.handleSocial(t.player.id, { kind: 'chat', text: 'to all', channel: 'all' })
    expect(t.director.lurkers.lastHeard({ x: 100, z: 100 })).toBe('secret plan')
    expect(t.director.lurkers.lastHeard({ x: 100 + MIMIC_HEARD + 5, z: 100 })).toBeNull()
  })

  test('at most two at night; by day the ones nobody is near slip away', async () => {
    const t = await server()
    t.run(0.2)
    t.sv().self.age = SHIELD_SECONDS
    const at = t.def.zombieSpots[0]?.pos ?? [0, 0, 0]
    t.move(at[0] + 300, at[2] + 300)
    // A long night: the rolls bring out a mimic or two, never more.
    let most = 0
    let seen = -1
    for (let s = 0; s < 480 && (seen < 0 || s < seen + 90); s++) {
      t.run(1)
      t.move(at[0] + 300, at[2] + 300)
      t.player.protectedUntil = Number.POSITIVE_INFINITY
      most = Math.max(most, t.director.lurkers.mimicCount)
      if (most > 0 && seen < 0) seen = s
    }
    expect(most).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(MIMIC_MAX)
    // Daylight, and nobody close: gone.
    t.director.setTime(0.6)
    t.run(2.5)
    expect(t.director.lurkers.mimicCount).toBe(0)
  })
})

describe('your turned self', () => {
  test('killed by the dead: you get up in your clothes with your name over you', async () => {
    const t = await server()
    t.run(0.5)
    const self = t.sv().self
    self.age = SHIELD_SECONDS
    give(self, 'beans', 2)
    self.wear.body = 'policevest'
    const where = { ...t.player.state.pos }
    const zombie = t.insides.pool[0] as ServerPlayer
    t.game.killPlayer(t.player.id, zombie.id)
    const [rid] = [...t.insides.turned.keys()]
    const risen = t.game.players.get(rid ?? -1)
    if (!risen) throw new Error('nobody turned')
    expect(risen.name).toBe('P0, turned')
    expect(risen.appearance).toBe(t.player.appearance)
    expect(Math.hypot(risen.state.pos.x - where.x, risen.state.pos.z - where.z)).toBeLessThan(1)
    const story = t.inbox.findLast((m) => m.type === ServerMsg.Notice && m.notice.kind === 'story')
    expect(story?.type === ServerMsg.Notice && story.notice.text).toContain('turned')
  })

  test('the turned walk on after a restart, still carrying everything', async () => {
    const store = new MemoryStore()
    const one = await server(store)
    one.run(0.5)
    const self = one.sv().self
    self.age = SHIELD_SECONDS
    give(self, 'beans', 2)
    const at = one.def.zombieSpots[0]?.pos ?? [0, 0, 0]
    one.move(at[0] + 300, at[2] + 300)
    const where = { ...one.player.state.pos }
    one.game.killPlayer(one.player.id, (one.insides.pool[0] as ServerPlayer).id)
    expect(one.insides.turned.size).toBe(1)
    one.director.saveAll()
    await one.game.saves.flush()
    expect(one.game.saves.world.turned?.[0]?.name).toBe('P0')

    const two = await server(store)
    two.move(where.x + 60, where.z)
    two.run(1)
    const back = [...two.game.players.values()].find((p) => p.name === 'P0, turned')
    if (!back) throw new Error('not back')
    expect(back.state.alive).toBe(true)
    expect(Math.hypot(back.state.pos.x - where.x, back.state.pos.z - where.z)).toBeLessThan(2)
    const stuff = two.insides.turned.get(back.id)?.stuff ?? []
    expect(stuff.filter((s) => s.item === 'beans').reduce((n, s) => n + s.n, 0)).toBe(2)
  })
})

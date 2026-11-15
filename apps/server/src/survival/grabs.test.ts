import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
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
import { MemoryStore } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import { GRABBED_SPEED, HOLD_MAX, MASH_PRESSES } from './grabs.ts'
import type { Zed } from './horde.ts'
import { SHIELD_SECONDS } from './newcomer.ts'

beforeAll(async () => {
  await initPhysics()
})

type Insides = {
  survivors: Map<number, { self: SurvivalSelf }>
  zeds: Map<number, Zed>
  pool: ServerPlayer[]
}

/** A Deadwood server with two people out in the woods, past the shield, and a walker. */
async function server() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(11))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(new MemoryStore())
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const inbox: ServerMessage[] = []
  const join = (name: string, box: ServerMessage[] = []) => {
    const id = game.join(name, { send: (b: Uint8Array) => box.push(decodeServerMessage(b)) })
    const p = game.players.get(id ?? -1)
    if (!p) throw new Error('no player')
    return p
  }
  const me = join('P0', inbox)
  const friend = join('P1')
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  run(0.5)
  const haven = def.pois.find((p) => p.safe)
  if (!haven) throw new Error('no haven')
  const place = (p: ServerPlayer, x: number, z: number) => {
    p.state.pos = { x, y: heightAt(def.terrain, x, z) + 0.05, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = 0
  }
  const x = haven.x + haven.r + 220
  for (const p of [me, friend]) {
    const self = insides.survivors.get(p.id)?.self
    if (self) self.age = SHIELD_SECONDS
  }
  place(me, x, haven.z)
  place(friend, x + 30, haven.z)
  const walker = insides.pool.find(
    (z) => insides.zeds.get(z.id)?.kind === ZombieKind.Walker,
  ) as ServerPlayer
  // Awake and on its feet (whatever the pool had it doing).
  walker.state.alive = true
  const zed = insides.zeds.get(walker.id) as Zed
  zed.crawler = false
  zed.hunter = false
  let seq = 1_000_000
  /** `p` presses E once (a press and a release). */
  const pressUse = (p: ServerPlayer) => {
    game.handleInput(p.id, [
      { seq: seq++, buttons: Button.Use, yaw: 0, pitch: 0, viewTick: game.tick },
    ])
    game.step()
    game.handleInput(p.id, [{ seq: seq++, buttons: 0, yaw: 0, pitch: 0, viewTick: game.tick }])
    game.step()
  }
  return { game, director, insides, inbox, me, friend, walker, run, place, pressUse }
}

describe('grabbed!', () => {
  test('held: slowed right down, told so, and the state goes to the client', async () => {
    const t = await server()
    t.place(t.walker, t.me.state.pos.x + 1, t.me.state.pos.z)
    t.walker.state.alive = true
    t.director.grabs.grab(t.me, t.walker)
    expect(t.director.speedFactor(t.me)).toBe(GRABBED_SPEED)
    t.run(0.1)
    const self = t.inbox.findLast((m) => m.type === ServerMsg.Survival)
    expect(self?.type === ServerMsg.Survival && self.self.grabbed).toBe(t.walker.id)
    const told = t.inbox.some((m) => m.type === ServerMsg.Notice && /Mash E/.test(m.notice.text))
    expect(told).toBe(true)
  })

  test('mashing E wrenches you free', async () => {
    const t = await server()
    t.place(t.walker, t.me.state.pos.x + 1, t.me.state.pos.z)
    t.director.grabs.grab(t.me, t.walker)
    for (let i = 0; i < MASH_PRESSES - 1; i++) t.pressUse(t.me)
    expect(t.director.grabs.heldBy(t.me)).toBe(t.walker)
    t.pressUse(t.me)
    expect(t.director.grabs.heldBy(t.me)).toBeUndefined()
    expect(t.director.speedFactor(t.me)).toBe(1)
  })

  test('a friend pressing E right by you pulls you free at once', async () => {
    const t = await server()
    t.place(t.walker, t.me.state.pos.x + 1, t.me.state.pos.z)
    t.director.grabs.grab(t.me, t.walker)
    t.place(t.friend, t.me.state.pos.x - 1, t.me.state.pos.z)
    t.pressUse(t.friend)
    expect(t.director.grabs.heldBy(t.me)).toBeUndefined()
  })

  test('a friend hitting it knocks it off you', async () => {
    const t = await server()
    t.place(t.walker, t.me.state.pos.x + 1, t.me.state.pos.z)
    t.director.grabs.grab(t.me, t.walker)
    t.game.hurt(t.walker, t.friend, 10)
    expect(t.director.grabs.heldBy(t.me)).toBeUndefined()
  })

  test('alone, it hurts, but it lets go in the end', async () => {
    const t = await server()
    t.place(t.walker, t.me.state.pos.x + 1, t.me.state.pos.z)
    const before = t.me.health
    t.director.grabs.grab(t.me, t.walker)
    t.run(HOLD_MAX + 0.3)
    expect(t.director.grabs.heldBy(t.me)).toBeUndefined()
    expect(t.me.health).toBeLessThan(before)
  })

  test('the shielded, people in cars and the ankle-held are never grabbed', async () => {
    const t = await server()
    const self = t.insides.survivors.get(t.me.id)?.self
    if (!self) throw new Error('no survivor')
    self.age = 10
    let grabbed = 0
    for (let i = 0; i < 60; i++) if (t.director.grabs.struck(t.me, t.walker)) grabbed++
    expect(grabbed).toBe(0)
    self.age = SHIELD_SECONDS
    for (let i = 0; i < 60 && !t.director.grabs.heldBy(t.me); i++)
      t.director.grabs.struck(t.me, t.walker)
    expect(t.director.grabs.heldBy(t.me)).toBe(t.walker)
  })
})

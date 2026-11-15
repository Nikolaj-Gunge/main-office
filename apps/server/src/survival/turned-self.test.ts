import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
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
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore } from '../saves.ts'
import type { SurvivalDirector } from './director.ts'
import type { Zed } from './horde.ts'
import { SHIELD_SECONDS } from './newcomer.ts'
import { GUARD_RING, LEASH, OFFER_SECONDS, STEER_SECONDS } from './turned-self.ts'

beforeAll(async () => {
  await initPhysics()
})

type Insides = {
  survivors: Map<number, { self: SurvivalSelf }>
  zeds: Map<number, Zed>
  turned: Map<number, { stuff: { item: string; n: number }[]; look: number }>
  pool: ServerPlayer[]
}

/** A Deadwood server with P0 out in the woods (past the shield), carrying beans. */
async function server() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(new MemoryStore())
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const inbox: ServerMessage[] = []
  const join = (name: string, box: ServerMessage[]) => {
    const id = game.join(name, { send: (b: Uint8Array) => box.push(decodeServerMessage(b)) })
    const p = game.players.get(id ?? -1)
    if (!p) throw new Error('no player')
    return p
  }
  const player = join('P0', inbox)
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  const place = (p: ServerPlayer, x: number, z: number) => {
    p.state.pos = { x, y: heightAt(def.terrain, x, z) + 0.05, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = 0
  }
  run(0.5)
  const self = insides.survivors.get(player.id)?.self
  if (!self) throw new Error('no survivor')
  self.age = SHIELD_SECONDS
  give(self, 'beans', 3)
  const haven = def.pois.find((p) => p.safe)
  if (!haven) throw new Error('no haven')
  // Out in the woods, well away from Haven.
  const out = { x: haven.x + haven.r + 260, z: haven.z }
  place(player, out.x, out.z)
  /** The dead get P0: their body gets up. */
  const turn = () => {
    game.killPlayer(player.id, (insides.pool[0] as ServerPlayer).id)
    const [rid] = [...insides.turned.keys()]
    const body = game.players.get(rid ?? -1)
    if (!body) throw new Error('nobody turned')
    return body
  }
  let seq = 1_000_000
  /** P0's client sends `buttons` looking along `yaw`, for `seconds`. */
  const hold = (buttons: number, yaw: number, seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) {
      game.handleInput(player.id, [{ seq: seq++, buttons, yaw, pitch: 0, viewTick: game.tick }])
      game.step()
    }
  }
  const lastSelf = () => {
    const m = inbox.findLast((m) => m.type === ServerMsg.Survival)
    return m?.type === ServerMsg.Survival ? m.self : null
  }
  return {
    game,
    director,
    insides,
    def,
    inbox,
    player,
    run,
    place,
    turn,
    hold,
    lastSelf,
    haven,
    join,
  }
}

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

describe('your turned self', () => {
  test('turning offers the wheel and holds the wake-up meanwhile', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    expect(t.lastSelf()?.turned?.body).toBe(body.id)
    expect(t.lastSelf()?.turned?.offer).toBeGreaterThan(OFFER_SECONDS - 1)
    // Past the usual wait, still dead: the offer stands.
    t.run(7)
    expect(t.player.state.alive).toBe(false)
    // Unanswered, they wake at Haven anyway.
    t.run(OFFER_SECONDS - 6)
    expect(t.player.state.alive).toBe(true)
    expect(t.lastSelf()?.turned).toBeUndefined()
  })

  test('declining wakes you at Haven now', async () => {
    const t = await server()
    t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: false })
    t.run(0.1)
    expect(t.player.state.alive).toBe(true)
  })

  test('steering: your input walks the body at the dead pace, guns and hands do nothing', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    const zed = t.insides.zeds.get(body.id) as Zed
    expect(zed.steered).toBe(true)
    t.run(0.1)
    expect(t.lastSelf()?.turned?.left).toBeGreaterThan(STEER_SECONDS - 1)
    const from = { ...body.state.pos }
    // Forward (yaw 0 looks along −z), with sprint, use and gun keys mashed too.
    const junk = Button.Sprint | Button.Use | Button.Slot1 | Button.Reload
    t.hold(Button.Forward | junk, 0, 3)
    const moved = flat(body.state.pos, from)
    expect(body.state.pos.z).toBeLessThan(from.z - 2)
    // The dead's pace: well under a living walk (~4.5 m/s), no sprinting.
    expect(moved / 3).toBeLessThan(4)
    expect(t.player.state.alive).toBe(false)
    expect(t.insides.turned.get(body.id)?.stuff.some((s) => s.item === 'beans')).toBe(true)
  })

  test('after a minute the dead take it back (still carrying) and you wake at Haven', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    t.hold(0, 0, STEER_SECONDS + 0.5)
    expect(t.player.state.alive).toBe(true)
    expect(flat(t.player.state.pos, t.haven)).toBeLessThan(t.haven.r + 20)
    expect(body.state.alive).toBe(true)
    expect((t.insides.zeds.get(body.id) as Zed).steered).toBe(false)
    expect(t.insides.turned.has(body.id)).toBe(true)
  })

  test('put down while steered: you wake at once, and its things fall there', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    t.run(0.5)
    const hunter = t.join('Hunter', [])
    t.run(0.5)
    t.game.killPlayer(body.id, hunter.id)
    t.run(0.1)
    expect(t.player.state.alive).toBe(true)
    expect(t.insides.turned.has(body.id)).toBe(false)
  })

  test('the leash: it never gets further than LEASH from where it got up', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    const from = { ...body.state.pos }
    t.hold(Button.Forward, Math.PI / 2, 40)
    expect(flat(body.state.pos, from)).toBeLessThanOrEqual(LEASH + 0.5)
  })

  test("Haven's guards put it down at the fence: no walking your things home", async () => {
    const t = await server()
    // Turned just outside the guards' reach, walking straight at Haven.
    t.place(t.player, t.haven.x + t.haven.r + GUARD_RING + 3, t.haven.z)
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    // Facing −x (towards Haven) is yaw π/2.
    t.hold(Button.Forward, Math.PI / 2, 6)
    // Put down (its pool slot may already be some other zombie): no longer one of the turned.
    expect(t.insides.turned.has(body.id)).toBe(false)
    expect(t.player.state.alive).toBe(true)
    expect(flat(t.player.state.pos, t.haven)).toBeLessThan(t.haven.r + 20)
  })

  test('its claws never touch a shielded newcomer; others they can', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    const fresh = t.join('Fresh', [])
    t.run(0.2)
    const freshSelf = t.insides.survivors.get(fresh.id)?.self
    if (!freshSelf) throw new Error('no survivor')
    freshSelf.age = 30
    t.place(fresh, body.state.pos.x, body.state.pos.z - 1)
    expect(t.director.canHurt(body, fresh)).toBe(false)
    freshSelf.age = SHIELD_SECONDS
    expect(t.director.canHurt(body, fresh)).toBe(true)
    // An ordinary zombie isn't held back by this.
    freshSelf.age = 30
    expect(t.director.canHurt(t.insides.pool[5] as ServerPlayer, fresh)).toBe(true)
  })

  test('chat comes out as a groan from the body; nothing else gets said', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    t.director.onAction(t.player, { a: 'turned', take: true })
    const box: ServerMessage[] = []
    const near = t.join('Near', box)
    t.run(0.2)
    t.place(near, body.state.pos.x + 5, body.state.pos.z)
    t.game.handleSocial(t.player.id, {
      kind: 'chat',
      text: 'come get my loot at the barn',
      channel: 'nearby',
    })
    const said = box.filter((m) => m.type === ServerMsg.Social && m.social.kind === 'chat')
    expect(said.length).toBe(1)
    const s = said[0]
    if (s?.type !== ServerMsg.Social || s.social.kind !== 'chat') throw new Error('no chat')
    expect(s.social.from).toBe(body.id)
    expect(s.social.text).not.toContain('loot')
  })

  test('an offer for a body that is gone wakes you instead', async () => {
    const t = await server()
    const body = t.turn()
    t.run(0.2)
    const hunter = t.join('Hunter', [])
    t.run(0.2)
    t.game.killPlayer(body.id, hunter.id)
    t.director.onAction(t.player, { a: 'turned', take: true })
    t.run(0.1)
    expect(t.player.state.alive).toBe(true)
  })
})

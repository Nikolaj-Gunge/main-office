import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  give,
  heightAt,
  initPhysics,
  loadMap,
  mergeRules,
  RESTED_SECONDS,
  type ServerMessage,
  ServerMsg,
  STARVE_FLOOR,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { Game } from '../game.ts'

beforeAll(async () => {
  await initPhysics()
})

function setup() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  const inbox: ServerMessage[] = []
  const id = game.join('P0', { send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }) ?? 0
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const player = () => {
    const p = game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  let seq = 1
  /** Ticks with (empty) input, so the player's body moves: falls, lands. */
  const live = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) {
      game.handleInput(id, [{ seq: seq++, buttons: 0, yaw: 0, pitch: 0, viewTick: game.tick }])
      game.step()
    }
  }
  const sv = () => {
    const d = (
      game.match as unknown as { survival: { survivors: Map<number, { self: SurvivalSelf }> } }
    ).survival
    const s = d.survivors.get(id)
    if (!s) throw new Error('no survivor')
    return s
  }
  /** Puts the player somewhere (feet), safe from the dead. */
  const move = (x: number, y: number, z: number) => {
    const p = player()
    p.state.pos = { x, y, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = Number.POSITIVE_INFINITY
  }
  const notices = () => inbox.flatMap((m) => (m.type === ServerMsg.Notice ? [m.notice.text] : []))
  /** Open ground well away from any building, lake or fire. */
  const open = () => {
    const x = def.pois[0]?.x ?? 0
    const z = (def.pois[0]?.z ?? 0) + 60
    return { x, z, y: heightAt(def.terrain, x, z) }
  }
  return { game, def, id, player, run, live, sv, move, notices, open }
}

describe('needs in the survival game', () => {
  test('starving and parched hurt slowly but never kill: health stops at 15', () => {
    const t = setup()
    t.run(1)
    const self = t.sv().self
    t.player().health = 30
    t.player().protectedUntil = Number.POSITIVE_INFINITY
    for (let i = 0; i < 120; i++) {
      self.hunger = 0
      self.thirst = 0
      t.run(1)
    }
    expect(t.player().state.alive).toBe(true)
    expect(t.player().health).toBe(STARVE_FLOOR)
  })

  test('sitting at the Haven bonfire for 20 s makes you Rested', () => {
    const t = setup()
    t.run(1)
    const fire = t.def.fires?.reduce((a, b) => (b.r > a.r ? b : a))
    if (!fire) throw new Error('no fires')
    t.move(fire.pos[0] + 2.5, fire.pos[1], fire.pos[2])
    t.run(22)
    expect(t.sv().self.needs?.rested).toBeGreaterThan(RESTED_SECONDS - 10)
    expect(t.notices().some((n) => n.includes('rested'))).toBe(true)
  })

  test('a long fall sprains an ankle; a bandage binds it', () => {
    const t = setup()
    t.run(1)
    const g = t.open()
    t.move(g.x, g.y + 2, g.z)
    t.live(2)
    expect(t.sv().self.needs?.sprain).toBe(0)
    t.move(g.x, g.y + 7, g.z)
    t.live(2)
    const self = t.sv().self
    expect(self.needs?.sprain).toBeGreaterThan(170)
    expect(t.player().body.config.sprintMultiplier).toBeLessThan(1.2)
    give(self, 'bandage', 1)
    const s = self.inv.find((h) => h.item === 'bandage')
    if (!s) throw new Error('no bandage')
    t.game.handleAction(t.id, { a: 'use', from: { c: s.c, x: s.x, y: s.y } })
    t.run(3.5) // a bandage takes 3 s to put on (crafting.ts)
    expect(self.needs?.sprain).toBe(0)
    expect(t.player().body.config.sprintMultiplier).toBeGreaterThan(1.3)
  })

  test('rain soaks you outdoors; Wet is told with how to fix it', () => {
    const t = setup()
    t.run(1)
    t.game.match.pinWeather('storm')
    const g = t.open()
    t.move(g.x, g.y, g.z)
    t.run(20)
    expect(t.sv().self.needs?.wet).toBeGreaterThan(30)
    expect(t.notices().some((n) => n.startsWith('Wet.'))).toBe(true)
  })
})

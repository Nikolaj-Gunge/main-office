import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  initPhysics,
  loadMap,
  type MatchInfo,
  mergeRules,
  ROUND_END_SECONDS,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
  WeaponId,
} from '@office-fps/shared'
import { Game } from './game.ts'

beforeAll(async () => {
  await initPhysics()
})

function client() {
  const inbox: ServerMessage[] = []
  return { inbox, send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }
}

/** A zombies run on Outbreak with `n` people who stand still (no input). */
function setup(n = 1) {
  const map = loadMap('outbreak')
  const game = new Game(map, createPhysicsWorld(map), mulberry(7))
  const clients = Array.from({ length: n }, () => client())
  const ids = clients.map((c, i) => game.join(`P${i}`, c) ?? 0)
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'zombies' }))
  const match = (): MatchInfo => {
    const m = clients[0]?.inbox.filter((x) => x.type === ServerMsg.Match).at(-1)
    if (!m || m.type !== ServerMsg.Match) throw new Error('no match info')
    return m.match
  }
  const player = (id: number) => {
    const p = game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  const zombies = () => [...game.players.values()].filter((p) => p.zombie)
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  return { game, clients, ids, match, player, zombies, run }
}

function mulberry(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t + 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('zombies mode', () => {
  test('picking zombies moves the server to the co-op map', () => {
    expect(mergeRules(DEFAULT_RULES, { mode: 'zombies' }).map).toBe('outbreak')
    const zombies = mergeRules(DEFAULT_RULES, { mode: 'zombies' })
    expect(mergeRules(zombies, { map: 'office' }).mode).toBe('ffa')
  })

  test('survivors start at the front door; a zombie pool waits, out of the scoreboard', () => {
    const { ids, player, zombies, match, clients } = setup(2)
    for (const id of ids) {
      const p = player(id)
      expect(p.team).toBe(1)
      expect(p.state.pos.z).toBeGreaterThan(-4)
    }
    expect(zombies().length).toBeGreaterThan(10)
    expect(match().coop?.stage).toBe(0)
    expect(match().players.length).toBe(2)
    const joined = clients[0]?.inbox.filter((m) => m.type === ServerMsg.PlayerJoined) ?? []
    expect(joined.some((m) => m.type === ServerMsg.PlayerJoined && (m.kind ?? 0) > 0)).toBe(true)
  })

  test('zombies climb out, walk to a survivor who stands still and claw them down', () => {
    const { ids, player, zombies, run, game } = setup(1)
    const me = player(ids[0] ?? 0)
    // The first one climbs out well away from the survivor.
    for (let t = 0; t < 9 * TICK_RATE && !zombies().some((z) => z.state.alive); t++) game.step()
    const first = zombies().find((z) => z.state.alive)
    expect(first?.state.weapon.id).toBe(WeaponId.Claws)
    const p = first?.state.pos ?? me.state.pos
    expect(Math.hypot(p.x - me.state.pos.x, p.z - me.state.pos.z)).toBeGreaterThan(8)
    run(3)
    expect(zombies().filter((z) => z.state.alive).length).toBeGreaterThan(2)
    // Stand still (idle inputs) until the horde gets there.
    let hurt = false
    for (let t = 0; t < 40 * TICK_RATE && me.state.alive; t++) {
      game.handleInput(me.id, [{ seq: t + 1, buttons: 0, yaw: 0, pitch: 0, viewTick: game.tick }])
      game.step()
      if (me.health < 100) hurt = true
    }
    expect(hurt).toBe(true)
    expect(me.state.alive).toBe(false)
  })

  test('everyone down: overrun, then the same stage again', () => {
    const { ids, player, game, match, run } = setup(1)
    const me = player(ids[0] ?? 0)
    const zombie = [...game.players.values()].find((p) => p.zombie)
    game.killPlayer(me.id, zombie?.id ?? me.id)
    run(0.1)
    expect(match().phase).toBe('ended')
    expect(match().result?.headline).toContain('Overrun')
    run(ROUND_END_SECONDS + 0.5)
    expect(match().phase).toBe('playing')
    expect(me.state.alive).toBe(true)
    expect(match().coop?.stage).toBe(0)
  })

  test('kill goal → the gate opens and the next stage starts; reaching the door → the next', () => {
    const { ids, player, game, match, run, zombies } = setup(1)
    const me = player(ids[0] ?? 0)
    me.protectedUntil = Number.POSITIVE_INFINITY // don't get clawed while we count kills
    const needed = match().coop?.kills?.[1] ?? 0
    expect(needed).toBeGreaterThan(0)
    let killed = 0
    for (let t = 0; t < 120 * TICK_RATE && killed < needed; t++) {
      game.step()
      const z = zombies().find((x) => x.state.alive)
      if (z) {
        game.killPlayer(z.id, me.id)
        killed++
      }
    }
    run(0.1)
    expect(match().coop?.stage).toBe(1)
    expect((match().coop?.gates ?? 0) & 1).toBe(1)
    // Walk-in substitute: put them in the reach zone.
    me.state.pos = { x: 0, y: 0, z: -56 }
    run(0.1)
    expect(match().coop?.stage).toBe(2)
  })

  test('holding the console fills the progress bar only while someone is in the zone', () => {
    const { ids, player, game, match, run } = setup(1)
    const me = player(ids[0] ?? 0)
    me.protectedUntil = Number.POSITIVE_INFINITY
    // Skip ahead to the server room.
    game.match.startRound(false)
    ;(game.match as unknown as { zombies: { startRun(s: number): void } }).zombies.startRun(2)
    game.respawnNow(me)
    me.protectedUntil = Number.POSITIVE_INFINITY
    run(2)
    expect(match().coop?.progress ?? 1).toBe(0)
    me.state.pos = { x: 0, y: 0, z: -78 }
    run(5)
    const held = match().coop?.progress ?? 0
    expect(held).toBeGreaterThan(0.08)
    expect(held).toBeLessThan(0.2)
  })
})

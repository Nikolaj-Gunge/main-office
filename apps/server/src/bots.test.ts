import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  initPhysics,
  loadMap,
  MAPS,
  MAX_PLAYERS,
  MapBuilder,
  mergeRules,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
} from '@office-fps/shared'
import { Game } from './game.ts'

beforeAll(async () => {
  await initPhysics()
})

/** Open 40 × 40 m floor: nowhere to hide. */
function openArena() {
  const m = new MapBuilder('arena', 'Arena', {
    sunDirection: [0, 1, 0],
    sunColor: 0,
    sunIntensity: 0,
    skyColor: 0,
    groundColor: 0,
    ambientIntensity: 0,
    fogColor: 0,
    fogNear: 0,
    fogFar: 0,
  })
  m.span([-20, -1, -20], [20, 0, 20], 'floor')
  m.spawn(-15, 0, 15).spawn(15, 0, -15)
  m.randomSpawnsIn([-18, -18], [18, 18])
  const map = m.build()
  return new Game(map, createPhysicsWorld(map), mulberry(7))
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function client() {
  const inbox: ServerMessage[] = []
  return { inbox, send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }
}

describe('bots', () => {
  test('the rules decide how many bots play', () => {
    const game = openArena()
    game.setRules(mergeRules(DEFAULT_RULES, { bots: 3 }))
    expect([...game.players.keys()].filter((id) => game.isBot(id)).length).toBe(3)
    game.setRules(mergeRules(DEFAULT_RULES, { bots: 1 }))
    expect([...game.players.keys()].filter((id) => game.isBot(id)).length).toBe(1)
  })

  test('a hard bot finds and kills a player standing in the open', () => {
    const game = openArena()
    const me = client()
    const id = game.join('Anna', me) ?? 0
    game.setRules(mergeRules(DEFAULT_RULES, { bots: 1, botSkill: 'hard', spawnWeapon: 'rifle' }))
    let seq = 1
    for (let t = 0; t < 30 * TICK_RATE; t++) {
      game.handleInput(id, [{ seq: seq++, buttons: 0, yaw: 0, pitch: 0, viewTick: game.tick }])
      game.step()
    }
    const kills = me.inbox.filter((m) => m.type === ServerMsg.Kill && m.victimId === id)
    expect(kills.length).toBeGreaterThan(0)
  })

  test('a person always gets in: a bot makes room', () => {
    const game = openArena()
    for (let i = 0; i < MAX_PLAYERS - 2; i++) game.join(`P${i}`, client())
    game.setRules(mergeRules(DEFAULT_RULES, { bots: 2 }))
    expect(game.players.size).toBe(MAX_PLAYERS)
    expect(game.join('Late', client())).not.toBeNull()
    expect(game.players.size).toBe(MAX_PLAYERS)
  })

  for (const mapId of Object.keys(MAPS)) {
    test(`bots play on ${mapId} without errors`, () => {
      const map = loadMap(mapId)
      const game = new Game(map, createPhysicsWorld(map), mulberry(3))
      game.setRules(mergeRules(DEFAULT_RULES, { bots: 4, spawnWeapon: 'random' }))
      for (let t = 0; t < 10 * TICK_RATE; t++) game.step()
      for (const p of game.players.values()) {
        expect(Number.isFinite(p.state.pos.x + p.state.pos.y + p.state.pos.z)).toBe(true)
      }
    })
  }
})

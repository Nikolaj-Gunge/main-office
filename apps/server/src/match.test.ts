import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  type GameRules,
  GUN_GAME_LADDER,
  initPhysics,
  MapBuilder,
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

function arena() {
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
  m.span([-30, -1, -30], [30, 0, 30], 'floor')
  m.spawn(-20, 0, 20).spawn(20, 0, -20)
  m.randomSpawnsIn([-28, -28], [28, 28])
  const map = m.build()
  return new Game(map, createPhysicsWorld(map))
}

function client() {
  const inbox: ServerMessage[] = []
  return { inbox, send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }
}

/** A game in `mode` with `n` players; returns their ids. */
function setup(mode: GameRules['mode'], n: number, extra: Partial<GameRules> = {}) {
  const game = arena()
  const clients = Array.from({ length: n }, () => client())
  const ids = clients.map((c, i) => game.join(`P${i}`, c) ?? 0)
  game.setRules(mergeRules(DEFAULT_RULES, { mode, ...extra }))
  const lastMatch = () => {
    const m = clients[0]?.inbox.filter((x) => x.type === ServerMsg.Match).at(-1)
    if (!m || m.type !== ServerMsg.Match) throw new Error('no match info')
    return m.match
  }
  const p = (id: number) => {
    const player = game.players.get(id)
    if (!player) throw new Error('no player')
    return player
  }
  const seconds = (s: number) => {
    for (let t = 0; t < s * TICK_RATE; t++) game.step()
  }
  return { game, ids, lastMatch, p, seconds }
}

describe('free for all', () => {
  test('the first to the score limit wins; the next round starts with clean scores', () => {
    const { game, ids, lastMatch, p, seconds } = setup('ffa', 3, { scoreLimit: 5 })
    const [a = 0, b = 0] = ids
    for (let i = 0; i < 5; i++) {
      game.killPlayer(b, a)
      seconds(4) // respawn
    }
    expect(lastMatch().phase).toBe('ended')
    expect(lastMatch().result?.winnerId).toBe(a)
    expect(lastMatch().result?.awards[0]?.title).toBe('MVP')
    seconds(ROUND_END_SECONDS + 1)
    expect(lastMatch().phase).toBe('playing')
    expect(p(a).kills).toBe(0)
  })

  test('the round ends when the time runs out', () => {
    const { lastMatch, seconds } = setup('ffa', 2, { timeLimit: 1 })
    seconds(61)
    expect(lastMatch().phase).toBe('ended')
  })
})

describe('team deathmatch', () => {
  test('teams are balanced, teammates cannot hurt each other, kills score for the team', () => {
    const { game, ids, lastMatch, p } = setup('tdm', 4, { scoreLimit: 10 })
    const teams = ids.map((id) => p(id).team)
    expect(teams.filter((t) => t === 1).length).toBe(2)
    expect(teams.filter((t) => t === 2).length).toBe(2)
    const [a = 0, ...rest] = ids
    const mate = rest.find((id) => p(id).team === p(a).team) ?? 0
    const enemy = rest.find((id) => p(id).team !== p(a).team) ?? 0
    expect(game.match.canHurt(p(a), p(mate))).toBe(false)
    expect(game.match.canHurt(p(a), p(enemy))).toBe(true)
    game.killPlayer(enemy, a)
    expect(lastMatch().teamScores[p(a).team]).toBe(1)
  })
})

describe('last man standing', () => {
  test('the dead stay out; the last one standing wins', () => {
    const { game, ids, lastMatch, p, seconds } = setup('lms', 3)
    const [a = 0, b = 0, c = 0] = ids
    game.killPlayer(b, a)
    seconds(5)
    expect(p(b).state.alive).toBe(false)
    expect(lastMatch().phase).toBe('playing')
    game.killPlayer(c, a)
    expect(lastMatch().phase).toBe('ended')
    expect(lastMatch().result?.winnerId).toBe(a)
    seconds(ROUND_END_SECONDS + 1)
    expect(p(b).state.alive).toBe(true)
  })
})

describe('gun game', () => {
  test('two kills with your weapon move you up the ladder; the knife finishes it', () => {
    const { game, ids, lastMatch, p, seconds } = setup('gungame', 2)
    const [a = 0, b = 0] = ids
    expect(p(a).state.weapon.id).toBe(GUN_GAME_LADDER[0]?.weapon ?? WeaponId.Rifle)
    for (let level = 0; level < GUN_GAME_LADDER.length; level++) {
      const step = GUN_GAME_LADDER[level]
      if (!step) break
      expect(p(a).state.weapon.id).toBe(step.weapon)
      for (let k = 0; k < step.kills; k++) {
        game.killPlayer(b, a)
        seconds(4)
      }
    }
    expect(lastMatch().phase).toBe('ended')
    expect(lastMatch().result?.winnerId).toBe(a)
  })

  test('a knife kill sends the victim down a level', () => {
    const { game, ids, p, seconds } = setup('gungame', 2)
    const [a = 0, b = 0] = ids
    p(b).level = 2
    p(a).state.weapon.id = WeaponId.Knife
    game.killPlayer(b, a)
    seconds(4)
    expect(p(b).level).toBe(1)
  })
})

describe('infection', () => {
  test('one patient zero with only a knife; the killed join the infected; all infected ends it', () => {
    const { game, ids, lastMatch, p, seconds } = setup('infection', 3)
    const infected = ids.filter((id) => p(id).team === 2)
    expect(infected.length).toBe(1)
    const zero = infected[0] ?? 0
    expect(p(zero).state.weapon.id).toBe(WeaponId.Knife)
    expect(p(zero).body.config.walkSpeed).toBeGreaterThan(
      p(ids.find((id) => id !== zero) ?? 0).body.config.walkSpeed,
    )
    for (const id of ids.filter((x) => x !== zero)) {
      game.killPlayer(id, zero)
      seconds(4)
      expect(p(id).team).toBe(2)
      expect(p(id).state.weapon.id).toBe(WeaponId.Knife)
    }
    expect(lastMatch().phase).toBe('ended')
    expect(lastMatch().result?.winnerTeam).toBe(2)
  })

  test('survivors win if anyone is alive when time runs out', () => {
    const { lastMatch, seconds } = setup('infection', 3, { timeLimit: 1 })
    seconds(61)
    expect(lastMatch().result?.winnerTeam).toBe(1)
  })
})

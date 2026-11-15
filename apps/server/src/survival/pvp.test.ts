import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  groundAt,
  HANDS_SECONDS,
  initPhysics,
  LAWLESS_RADIUS,
  LAWLESS_TEXT,
  lawlessBorder,
  lawlessCentre,
  loadMap,
  lootTableOn,
  mergeRules,
  OATH_SECONDS,
  packStanding,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  standingOf,
  TICK_RATE,
  unpackStanding,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { SurvivalDirector } from './director.ts'
import { MURDER } from './pvp.ts'

beforeAll(async () => {
  await initPhysics()
})

interface Inside {
  survivors: Map<number, { player: ServerPlayer; self: SurvivalSelf }>
}

function setup() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(3))
  const inbox = new Map<number, ServerMessage[]>()
  const join = (name: string) => {
    const box: ServerMessage[] = []
    const id = game.join(name, { send: (b: Uint8Array) => box.push(decodeServerMessage(b)) }) ?? 0
    inbox.set(id, box)
    return id
  }
  const a = join('Ada')
  const b = join('Bo')
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const director = game.match.survivalDirector as SurvivalDirector
  const inside = game.match.survivalDirector as unknown as Inside
  const sv = (id: number) => {
    const s = inside.survivors.get(id)
    if (!s) throw new Error('no survivor')
    return s
  }
  const player = (id: number) => sv(id).player
  const put = (id: number, x: number, z: number, yaw = 0) => {
    const p = player(id)
    p.state.pos = { x, y: 0, z }
    p.state.yaw = yaw
    p.protectedUntil = 0
    p.health = p.maxHealth
  }
  /** Somewhere in the woods, on Lawless ground, and in Haven. */
  const haven = def.pois.find((p) => p.key === 'haven')
  const site7 = lawlessCentre(def.pois)
  if (!haven || !site7) throw new Error('no haven or site 7')
  const spots = {
    woods: { x: -300, z: -300 },
    lawless: { x: site7.x - 100, z: site7.z + 60 },
    haven: { x: haven.x + 3, z: haven.z + 3 },
  }
  const notices = (id: number) =>
    (inbox.get(id) ?? []).flatMap((m) => (m.type === ServerMsg.Notice ? [m.notice.text] : []))
  const run = (seconds: number) => {
    for (let k = 0; k < seconds * TICK_RATE; k++) game.step()
  }
  /** Facing (yaw) from one spot towards another. */
  const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    Math.atan2(-(to.x - from.x), -(to.z - from.z))
  return { game, def, director, a, b, sv, player, put, spots, notices, run, yawTo }
}

describe('pvp: the ground', () => {
  test('Haven, the woods and the Lawless ground round Site 7', () => {
    const { def, spots } = setup()
    expect(groundAt(def.pois, spots.haven)).toBe('haven')
    expect(groundAt(def.pois, spots.woods)).toBe('woods')
    expect(groundAt(def.pois, spots.lawless)).toBe('lawless')
    const c = lawlessCentre(def.pois)
    if (!c) throw new Error('no centre')
    expect(groundAt(def.pois, { x: c.x - LAWLESS_RADIUS - 5, z: c.z })).toBe('woods')
    expect(groundAt(def.pois, { x: c.x - LAWLESS_RADIUS + 5, z: c.z })).toBe('lawless')
    // No town is cut in two by the border.
    for (const p of def.pois.filter((q) => q.kind === 'town' || q.safe))
      expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(LAWLESS_RADIUS + p.r)
    // The border is signed all the way round (it's all inside the world).
    expect(lawlessBorder(def.pois, 40).length).toBeGreaterThan(45)
  })

  test('the border is marked: warning signs and red-painted trees', () => {
    const { def, game } = setup()
    expect((def.signs ?? []).filter((s) => s.kind === 'lawless').length).toBeGreaterThan(20)
    expect(game.world.map.boxes.filter((b) => b.material === 'redpaint').length).toBeGreaterThan(30)
  })

  test('loot is richer on Lawless ground', () => {
    expect(lootTableOn('homegun', 'lawless', 0.1)).toBe('gun')
    expect(lootTableOn('gun', 'lawless', 0.2)).toBe('military')
    expect(lootTableOn('homegun', 'lawless', 0.9)).toBe('homegun')
    expect(lootTableOn('homegun', 'woods', 0.1)).toBe('homegun')
    expect(lootTableOn('medical', 'lawless', 0.1)).toBe('medical')
  })
})

describe('pvp: the gate', () => {
  test('nobody hurts anybody in Haven, nor in the woods', () => {
    const { game, a, b, player, put, spots } = setup()
    for (const where of [spots.haven, spots.woods]) {
      put(a, where.x, where.z)
      put(b, where.x + 2, where.z)
      game.hurt(player(b), player(a), 40)
      expect(player(b).health).toBe(player(b).maxHealth)
    }
  })

  test('on Lawless ground anyone can shoot anyone', () => {
    const { game, a, b, player, put, spots } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    game.hurt(player(b), player(a), 40)
    expect(player(b).health).toBe(player(b).maxHealth - 40)
  })

  test('no shooting across the border from safe woods', () => {
    const { game, a, b, player, put, spots } = setup()
    put(a, spots.woods.x, spots.woods.z)
    put(b, spots.lawless.x, spots.lawless.z)
    game.hurt(player(b), player(a), 40)
    expect(player(b).health).toBe(player(b).maxHealth)
    // Nor from the lawless side into the woods.
    game.hurt(player(a), player(b), 40)
    expect(player(a).health).toBe(player(a).maxHealth)
  })

  test('crossing the border is announced', () => {
    const { a, put, spots, notices, run } = setup()
    put(a, spots.woods.x, spots.woods.z)
    run(1.1)
    put(a, spots.lawless.x, spots.lawless.z)
    run(1.1)
    expect(notices(a)).toContain(LAWLESS_TEXT.enter)
    put(a, spots.woods.x, spots.woods.z)
    run(1.1)
    expect(notices(a)).toContain(LAWLESS_TEXT.leave)
  })
})

describe('pvp: reputation', () => {
  test('killing somebody who never shot at you makes you a Raider; others see the armband', () => {
    const { game, director, a, b, sv, player, put, spots } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    sv(b).self.age = 99999
    game.hurt(player(b), player(a), 500)
    expect(player(b).state.alive).toBe(false)
    expect(sv(a).self.rep).toBe(-MURDER)
    expect(standingOf(sv(a).self.rep)).toBe('raider')
    const tags = unpackStanding(director.info().standing)
    expect(tags.get(a)?.standing).toBe('raider')
    expect(tags.has(b)).toBe(false)
  })

  test('shooting back is self-defence: no stain', () => {
    const { game, a, b, sv, player, put, spots } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    game.hurt(player(a), player(b), 10)
    game.hurt(player(b), player(a), 500)
    expect(player(b).state.alive).toBe(false)
    expect(sv(a).self.rep ?? 0).toBe(0)
    expect(standingOf(sv(a).self.rep)).toBe('neutral')
  })

  test('killing a Raider is no murder; a raider stays one through death, then it wears off', () => {
    const { game, a, b, sv, player, put, spots, run } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    sv(b).self.rep = -6
    sv(b).self.age = 99999
    game.hurt(player(b), player(a), 500)
    expect(sv(a).self.rep ?? 0).toBe(0)
    // Dying didn't wash it off.
    expect(standingOf(sv(b).self.rep)).toBe('raider')
    // It fades with play: one point every quarter of an hour.
    sv(a).self.rep = -3
    put(a, spots.woods.x, spots.woods.z)
    run(2)
    expect(standingOf(sv(a).self.rep)).toBe('neutral')
  })

  test('waving at each other is a truce, and good deeds make a Saint', () => {
    const { game, director, a, b, sv, put, spots, notices, yawTo } = setup()
    const pa = spots.woods
    const pb = { x: pa.x + 3, z: pa.z }
    put(a, pa.x, pa.z, yawTo(pa, pb))
    put(b, pb.x, pb.z, yawTo(pb, pa))
    sv(a).self.rep = 3
    game.handleSocial(a, { kind: 'emote' })
    expect(notices(b).some((t) => t.includes('Wave back'))).toBe(true)
    game.handleSocial(b, { kind: 'emote' })
    expect(director.pvp.hasTruce(sv(a).player, sv(b).player)).toBe(true)
    expect(sv(a).self.rep).toBe(4)
    expect(standingOf(sv(a).self.rep)).toBe('saint')
    expect(sv(b).self.rep).toBe(1)
    expect(unpackStanding(director.info().standing).get(a)?.standing).toBe('saint')
  })

  test('a gift: something you put down that somebody else picks up', () => {
    const { director, a, b, sv, player } = setup()
    const at = { x: 10, z: 10 }
    director.pvp.dropped(player(a), 'beans', at)
    // Picking up your own isn't a gift.
    director.pvp.pickedUp(player(a), 'beans', at, new Map([[a, player(a)]]))
    expect(sv(a).self.rep ?? 0).toBe(0)
    director.pvp.pickedUp(player(b), 'beans', { x: 10.5, z: 10 }, new Map([[a, player(a)]]))
    expect(sv(a).self.rep).toBe(1)
  })
})

describe('pvp: the Oathbreaker', () => {
  test('killing somebody you had a truce with marks you for two hours of play', () => {
    const { game, director, a, b, sv, player, put, spots, notices, run, yawTo } = setup()
    const pa = spots.lawless
    const pb = { x: pa.x + 3, z: pa.z }
    put(a, pa.x, pa.z, yawTo(pa, pb))
    put(b, pb.x, pb.z, yawTo(pb, pa))
    sv(b).self.age = 99999
    game.handleSocial(a, { kind: 'emote' })
    game.handleSocial(b, { kind: 'emote' })
    expect(director.pvp.hasTruce(player(a), player(b))).toBe(true)
    game.hurt(player(b), player(a), 500)
    expect(player(b).state.alive).toBe(false)
    expect(sv(a).self.oath).toBe(OATH_SECONDS)
    expect(notices(a).some((t) => t.includes('Oathbreaker'))).toBe(true)
    expect(notices(b).some((t) => t.includes('broke your truce'))).toBe(true)
    const tag = unpackStanding(director.info().standing).get(a)
    expect(tag?.oathbreaker).toBe(true)
    expect(tag?.standing).toBe('raider')
    // The truce died with them.
    expect(director.pvp.hasTruce(player(a), player(b))).toBe(false)
    // It wears off with play.
    run(2)
    expect(sv(a).self.oath).toBeLessThan(OATH_SECONDS)
    sv(a).self.oath = 1
    run(1.1)
    expect(sv(a).self.oath ?? 0).toBe(0)
    expect(unpackStanding(director.info().standing).get(a)?.oathbreaker ?? false).toBe(false)
  })

  test('standing packs and unpacks', () => {
    const tags = [
      { id: 4, standing: 'saint' as const, oathbreaker: false },
      { id: 9, standing: 'raider' as const, oathbreaker: true },
    ]
    expect([...unpackStanding(packStanding(tags)).values()]).toEqual(tags)
    expect(unpackStanding(undefined).size).toBe(0)
  })
})

describe('pvp: hands up', () => {
  test('killing somebody with their hands up is murder, even if they shot first', () => {
    const { game, a, b, sv, player, put, spots, notices } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    sv(b).self.age = 99999
    game.hurt(player(a), player(b), 10)
    game.handleSocial(b, { kind: 'emote', emote: 'hands' })
    game.hurt(player(b), player(a), 500)
    expect(player(b).state.alive).toBe(false)
    expect(sv(a).self.rep).toBe(-MURDER)
    expect(notices(a)).toContain('Their hands were up. People will remember that.')
  })

  test('hands up wears off: afterwards shooting back is self-defence again', () => {
    const { game, a, b, sv, player, put, spots, run } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    game.handleSocial(b, { kind: 'emote', emote: 'hands' })
    run(HANDS_SECONDS + 1)
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    game.hurt(player(a), player(b), 10)
    game.hurt(player(b), player(a), 500)
    expect(sv(a).self.rep ?? 0).toBe(0)
  })

  test('hands up and then a gun makes you an Oathbreaker; others see the mark', () => {
    const { game, director, a, b, sv, player, put, spots, notices } = setup()
    put(a, spots.lawless.x, spots.lawless.z)
    put(b, spots.lawless.x + 2, spots.lawless.z)
    game.handleSocial(a, { kind: 'emote', emote: 'hands' })
    game.hurt(player(b), player(a), 10)
    expect(sv(a).self.oath).toBe(OATH_SECONDS)
    expect(notices(b)).toContain('Ada faked a surrender.')
    expect(unpackStanding(director.info().standing).get(a)?.oathbreaker).toBe(true)
  })

  test('everyone near sees the hands go up (a wave stays a wave)', () => {
    const { game, a, b, put, spots } = setup()
    put(a, spots.woods.x, spots.woods.z)
    put(b, spots.woods.x + 5, spots.woods.z)
    const seen: unknown[] = []
    const inner = game as unknown as { sendTo(p: ServerPlayer, m: ServerMessage): void }
    const send = inner.sendTo.bind(game)
    inner.sendTo = (p, m) => {
      if (m.type === ServerMsg.Social && p.id === b) seen.push(m.social)
      send(p, m)
    }
    game.handleSocial(a, { kind: 'emote', emote: 'hands' })
    expect(seen).toContainEqual({ kind: 'emote', from: a, emote: 'hands' })
  })
})

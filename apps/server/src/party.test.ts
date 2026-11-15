import { beforeAll, describe, expect, test } from 'bun:test'
import {
  cleanOffer,
  cleanPartyCode,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  type GameRules,
  give,
  initPhysics,
  inviteLink,
  loadMap,
  makePartyCode,
  mergeRules,
  PARTY_MAX,
  type PartyInfo,
  type ServerMessage,
  ServerMsg,
  type SocialEvent,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from './game.ts'
import { Parties, type PartyHost } from './party.ts'
import { SocialRelay } from './social.ts'

beforeAll(async () => {
  await initPhysics()
})

/** A pretend game: players at chosen spots, and every social event each one was sent. */
function world() {
  const players = new Map<number, ServerPlayer>()
  const inbox = new Map<number, SocialEvent[]>()
  const host: PartyHost & { tick: number } = {
    players,
    tick: 0,
    sendTo(player: ServerPlayer, msg: ServerMessage) {
      if (msg.type === ServerMsg.Social) inbox.get(player.id)?.push(msg.social)
    },
  }
  const add = (id: number, x = 0) => {
    const p = {
      id,
      name: `P${id}`,
      team: 1,
      state: { pos: { x, y: 0, z: 0 }, alive: true },
    } as unknown as ServerPlayer
    players.set(id, p)
    inbox.set(id, [])
    return p
  }
  let n = 0
  const parties = new Parties(host, () => (n++ * 0.137) % 1)
  const got = (id: number) => inbox.get(id) ?? []
  const party = (id: number): PartyInfo | undefined =>
    got(id)
      .filter((e): e is Extract<SocialEvent, { kind: 'party' }> => e.kind === 'party')
      .at(-1)?.party
  return { host, players, parties, add, got, party }
}

describe('camp codes and links', () => {
  test('codes are six unambiguous characters; typed codes are cleaned', () => {
    const code = makePartyCode(seeded(3))
    expect(code).toMatch(/^[A-Z2-9]{6}$/)
    expect(code).not.toMatch(/[01OIL]/)
    expect(cleanPartyCode(` ${code.toLowerCase()} `)).toBe(code)
    expect(cleanPartyCode('ABC')).toBeNull()
    expect(cleanPartyCode('ABCDE0')).toBeNull()
    expect(cleanPartyCode(42)).toBeNull()
    expect(inviteLink('https://x.dev', 'ABCDEF')).toBe('https://x.dev/join?camp=ABCDEF')
  })
})

describe('Parties', () => {
  test('joining a code makes the camp; others join it; everyone hears who is in', () => {
    const { parties, add, party } = world()
    const a = add(1)
    const b = add(2, 10)
    parties.handle(a, { kind: 'party', op: 'join', code: 'CAMPAA' })
    expect(party(1)?.members.map((m) => m.id)).toEqual([1])
    parties.handle(b, { kind: 'party', op: 'join', code: 'campaa' })
    expect(party(1)).toEqual({
      code: 'CAMPAA',
      leader: 1,
      members: [
        { id: 1, name: 'P1', x: 0, y: 0, z: 0, alive: true },
        { id: 2, name: 'P2', x: 10, y: 0, z: 0, alive: true },
      ],
    })
    expect(party(2)?.leader).toBe(1)
    expect(parties.mates(1)).toEqual([2])
    expect(parties.leaderOf(2)).toBe(1)
  })

  test(`at most ${PARTY_MAX}: the next one is told it's full and keeps a camp of their own`, () => {
    const { parties, add, got } = world()
    for (let id = 1; id <= PARTY_MAX; id++) parties.join(add(id), 'FULLUP')
    const late = add(9)
    expect(parties.join(late, 'FULLUP')).toBe(false)
    expect(got(9).some((e) => e.kind === 'system' && e.text.includes('full'))).toBe(true)
    expect(parties.mates(1)).toHaveLength(PARTY_MAX - 1)
    expect(parties.codeOf(9)).not.toBe('FULLUP')
    expect(parties.codeOf(9)).not.toBeNull()
  })

  test('leaving starts a camp of your own; the leader leaving hands the lead on', () => {
    const { parties, add, party } = world()
    const a = add(1)
    const b = add(2)
    const c = add(3)
    for (const p of [a, b, c]) parties.join(p, 'LEAVES')
    parties.handle(a, { kind: 'party', op: 'leave' })
    expect(parties.codeOf(1)).not.toBe('LEAVES')
    expect(parties.mates(1)).toEqual([])
    expect(party(2)?.leader).toBe(2)
    expect(parties.mates(2)).toEqual([3])
    // Disconnecting: out of the camp; the last one out ends it, and the code can be made again.
    parties.forget(2)
    parties.forget(3)
    const d = add(4)
    parties.join(d, 'LEAVES')
    expect(party(4)?.members.map((m) => m.id)).toEqual([4])
  })

  test('nonsense is ignored; the dead and the bots have no camp', () => {
    const { parties, add, got } = world()
    const a = add(1)
    parties.handle(a, { kind: 'party', op: 'join', code: '<script>' })
    expect(got(1)).toHaveLength(0)
    const zombie = { ...add(2), zombie: {} } as unknown as ServerPlayer
    parties.handle(zombie, { kind: 'party', op: 'join', code: 'ZZZZZZ' })
    expect(parties.codeOf(2)).toBeNull()
  })

  test('camps of two or more hear where everybody is once a second', () => {
    const { host, parties, add, got, players } = world()
    parties.join(add(1), 'SECOND')
    parties.join(add(2), 'SECOND')
    const before = got(1).length
    ;(players.get(2) as ServerPlayer).state.pos.x = 77
    host.tick = TICK_RATE * 5
    parties.step()
    expect(got(1).length).toBe(before + 1)
    host.tick++
    parties.step()
    expect(got(1).length).toBe(before + 1)
    const last = got(1).at(-1) as Extract<SocialEvent, { kind: 'party' }>
    expect(last.party.members.find((m) => m.id === 2)?.x).toBe(77)
  })

  test('pings reach camp-mates however far away (unless muted)', () => {
    const { players, add, got, parties } = world()
    const host = {
      players,
      tick: 1000,
      rules: { ...DEFAULT_RULES, mode: 'survival' } as GameRules,
      sendTo(player: ServerPlayer, msg: ServerMessage) {
        if (msg.type === ServerMsg.Social) got(player.id).push(msg.social)
      },
      mates: (id: number) => parties.mates(id),
    }
    const relay = new SocialRelay(host)
    const me = add(1)
    add(2, 1000)
    add(3, 1000)
    parties.join(me, 'PINGER')
    parties.join(players.get(2) as ServerPlayer, 'PINGER')
    const count = (id: number) => got(id).filter((e) => e.kind === 'ping').length
    relay.handle(me, { kind: 'ping', ping: 'loot', x: 0, y: 0, z: 0 })
    expect(count(2)).toBe(1)
    expect(count(3)).toBe(0)
    relay.handle(players.get(2) as ServerPlayer, { kind: 'mute', id: 1, muted: true })
    relay.handle(me, { kind: 'ping', ping: 'go', x: 0, y: 0, z: 0 })
    expect(count(2)).toBe(1)
  })
})

describe('trade offers', () => {
  test('only known, tradeable things in whole numbers; the same item merged', () => {
    expect(
      cleanOffer({
        items: [
          { item: 'water', n: 1 },
          { item: 'water', n: 2 },
        ],
        money: 12.7,
      }),
    ).toEqual({ items: [{ item: 'water', n: 3 }], money: 12 })
    expect(cleanOffer({ items: [{ item: 'nonsense', n: 1 }], money: 0 })).toBeNull()
    expect(cleanOffer({ items: [{ item: 'water', n: -1 }], money: 0 })).toBeNull()
    expect(cleanOffer({ items: [{ item: 'water', n: 1.5 }], money: 0 })).toBeNull()
    expect(cleanOffer({ items: [], money: -5 })).toBeNull()
    expect(cleanOffer({ items: [{ item: 'cash', n: 1 }], money: 0 })).toBeNull()
    expect(cleanOffer({ items: [{ item: 'whiskey', n: 1 }], money: Number.NaN })).toBeNull()
    expect(cleanOffer('lots')).toBeNull()
  })
})

// --- In a real survival game -------------------------------------------------------------

interface Inside {
  survivors: Map<number, { player: ServerPlayer; self: SurvivalSelf; dirty: boolean }>
  pool: ServerPlayer[]
  story: { talk(p: unknown, key: string): void }
}

function survival(n: number) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(11))
  const inboxes: ServerMessage[][] = []
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const inbox: ServerMessage[] = []
    inboxes.push(inbox)
    ids.push(game.join(`P${i}`, { send: (b) => inbox.push(decodeServerMessage(b)) }) ?? 0)
  }
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const inside = (game.match as unknown as { survival: Inside }).survival
  const sv = (i: number) => {
    const s = inside.survivors.get(ids[i] ?? -1)
    if (!s) throw new Error('no survivor')
    return s
  }
  const place = (i: number, x: number, z: number) => {
    const p = sv(i).player
    p.state.pos = { x, y: p.state.pos.y, z }
    p.protectedUntil = Number.POSITIVE_INFINITY
  }
  const events = (i: number) =>
    (inboxes[i] ?? []).flatMap((m) => (m.type === ServerMsg.Social ? [m.social] : []))
  const social = (i: number, req: Parameters<Game['handleSocial']>[1]) =>
    game.handleSocial(ids[i] ?? 0, req)
  return { game, def, inside, ids, sv, place, events, social }
}

describe('camp quest credit', () => {
  test('a delivery counts for camp-mates within 50 m on the same step, nobody else', () => {
    const t = survival(4)
    const gus = t.def.npcs.find((npc) => npc.key === 'gus')
    if (!gus) throw new Error('no Gus')
    const [gx, , gz] = gus.pos
    // 0 and 1 and 2 in a camp, 3 not; 2 is too far off.
    for (const i of [0, 1, 2]) t.social(i, { kind: 'party', op: 'join', code: 'WHSKEY' })
    t.place(0, gx + 1, gz)
    t.place(1, gx + 10, gz)
    t.place(2, gx + 200, gz)
    t.place(3, gx + 2, gz)
    for (let i = 0; i < 4; i++)
      t.sv(i).self.journal.quests.push({ id: 'whiskey', step: 0, count: 0 })
    give(t.sv(0).self, 'whiskey', 2)
    t.inside.story.talk(t.sv(0), 'gus')
    const done = (i: number) => t.sv(i).self.journal.done.includes('whiskey')
    expect([done(0), done(1), done(2), done(3)]).toEqual([true, true, false, false])
    // The reward is everybody's who got the credit; only the one who handed it over lost it.
    expect(t.sv(1).self.money).toBe(t.sv(0).self.money)
    expect(t.sv(0).self.inv.some((s) => s.item === 'whiskey')).toBe(false)
  })
})

describe('trading', () => {
  /** Two survivors side by side in the open, in no camp. */
  function pair() {
    const t = survival(2)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no Haven')
    t.place(0, haven.x, haven.z + 8)
    t.place(1, haven.x + 1.5, haven.z + 8)
    const a = t.sv(0).self
    const b = t.sv(1).self
    a.inv = []
    b.inv = []
    a.money = 100
    b.money = 10
    const open = () => {
      t.social(0, { kind: 'trade', op: 'ask', id: t.ids[1] ?? 0 })
      t.social(1, { kind: 'trade', op: 'ask', id: t.ids[0] ?? 0 })
    }
    const window = (i: number) =>
      t
        .events(i)
        .filter((e): e is Extract<SocialEvent, { kind: 'trade' }> => e.kind === 'trade')
        .at(-1)?.trade
    return { ...t, a, b, open, window }
  }

  test('asked and asked back: the window opens; both confirm and it all changes hands', () => {
    const t = pair()
    give(t.a, 'whiskey', 2)
    give(t.b, 'bandage', 3)
    t.social(0, { kind: 'trade', op: 'ask', id: t.ids[1] ?? 0 })
    expect(t.events(1).some((e) => e.kind === 'tradeAsk')).toBe(true)
    t.social(1, { kind: 'trade', op: 'ask', id: t.ids[0] ?? 0 })
    expect(t.window(0)?.with).toBe(t.ids[1])
    t.social(0, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'whiskey', n: 2 }], money: 40 },
    })
    t.social(1, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'bandage', n: 3 }], money: 0 },
    })
    expect(t.window(1)?.theirs).toEqual({ items: [{ item: 'whiskey', n: 2 }], money: 40 })
    t.social(0, { kind: 'trade', op: 'confirm' })
    expect(t.window(1)?.theirsOk).toBe(true)
    // Changing an offer takes both confirmations back.
    t.social(1, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'bandage', n: 2 }], money: 0 },
    })
    expect(t.window(0)?.theirsOk).toBe(false)
    expect(t.window(0)?.mineOk).toBe(false)
    t.social(0, { kind: 'trade', op: 'confirm' })
    t.social(1, { kind: 'trade', op: 'confirm' })
    expect(t.window(0)).toBeNull()
    const count = (self: SurvivalSelf, item: string) =>
      self.inv.filter((s) => s.item === item).reduce((n, s) => n + s.n, 0)
    expect([count(t.a, 'whiskey'), count(t.a, 'bandage'), t.a.money]).toEqual([0, 2, 60])
    expect([count(t.b, 'whiskey'), count(t.b, 'bandage'), t.b.money]).toEqual([2, 1, 50])
  })

  test('no duping: what is gone by the time both confirm stops the whole trade', () => {
    const t = pair()
    give(t.a, 'whiskey', 2)
    give(t.b, 'bandage', 1)
    t.open()
    t.social(0, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'whiskey', n: 2 }], money: 0 },
    })
    t.social(1, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'bandage', n: 1 }], money: 0 },
    })
    t.social(0, { kind: 'trade', op: 'confirm' })
    // B drops the bandage before confirming: nothing moves at all.
    t.b.inv = []
    t.social(1, { kind: 'trade', op: 'confirm' })
    expect(t.a.inv.filter((s) => s.item === 'whiskey').reduce((n, s) => n + s.n, 0)).toBe(2)
    expect(t.b.inv).toEqual([])
    expect(t.window(0)?.mineOk).toBe(false)
  })

  test("can't offer what you don't have, or more money than you have", () => {
    const t = pair()
    give(t.a, 'whiskey', 1)
    t.open()
    t.social(0, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'whiskey', n: 5 }], money: 0 },
    })
    t.social(1, { kind: 'trade', op: 'offer', offer: { items: [], money: 11 } })
    expect(t.window(0)?.mine.items).toEqual([])
    expect(t.window(0)?.theirs.money).toBe(0)
    expect(t.events(0).some((e) => e.kind === 'system' && e.text.includes("don't have"))).toBe(true)
  })

  test('no room on the other side: nothing changes hands', () => {
    const t = pair()
    give(t.a, 'whiskey', 1)
    // B's pockets full of bricks-worth of water.
    while (give(t.b, 'water', 1) === 1) {}
    const water = t.b.inv.length
    t.open()
    t.social(0, {
      kind: 'trade',
      op: 'offer',
      offer: { items: [{ item: 'whiskey', n: 1 }], money: 0 },
    })
    t.social(0, { kind: 'trade', op: 'confirm' })
    t.social(1, { kind: 'trade', op: 'confirm' })
    expect(t.a.inv.some((s) => s.item === 'whiskey')).toBe(true)
    expect(t.b.inv.length).toBe(water)
    expect(t.events(0).some((e) => e.kind === 'system' && e.text.includes('no room'))).toBe(true)
  })

  test('only within 3 m; walking off closes the window; dying calls it off', () => {
    const t = pair()
    t.place(1, (t.sv(0).player.state.pos.x ?? 0) + 6, t.sv(0).player.state.pos.z)
    t.social(0, { kind: 'trade', op: 'ask', id: t.ids[1] ?? 0 })
    expect(t.events(1).some((e) => e.kind === 'tradeAsk')).toBe(false)
    t.place(1, t.sv(0).player.state.pos.x + 1, t.sv(0).player.state.pos.z)
    t.open()
    expect(t.window(0)).toBeTruthy()
    t.place(1, t.sv(0).player.state.pos.x + 20, t.sv(0).player.state.pos.z)
    for (let i = 0; i < TICK_RATE; i++) t.game.step()
    expect(t.window(0)).toBeNull()
    expect(t.window(1)).toBeNull()
  })
})

describe('camps in survival', () => {
  test('a character who just woke and joins a camp is walked over to its leader', () => {
    const t = survival(2)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no Haven')
    // Keep the dead well away from the leader.
    t.place(0, haven.x, haven.z + 8)
    for (const z of t.inside.pool) z.state.alive = false
    t.sv(0).self.age = 9999
    t.sv(1).self.age = 5
    t.social(0, { kind: 'party', op: 'join', code: 'HAVENS' })
    t.social(1, { kind: 'party', op: 'join', code: 'HAVENS' })
    const a = t.sv(0).player.state.pos
    const b = t.sv(1).player.state.pos
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1)
  })

  test('not beside a leader with the dead close by', () => {
    const t = survival(2)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no Haven')
    t.place(0, haven.x, haven.z + 8)
    const zed = t.inside.pool[0]
    if (!zed) throw new Error('no dead')
    zed.state.alive = true
    zed.state.pos = { ...t.sv(0).player.state.pos, x: haven.x + 5 }
    t.sv(1).self.age = 5
    const was = { ...t.sv(1).player.state.pos }
    t.social(0, { kind: 'party', op: 'join', code: 'DANGER' })
    t.social(1, { kind: 'party', op: 'join', code: 'DANGER' })
    expect(t.sv(1).player.state.pos).toEqual(was)
  })

  test('an old character joining stays where they are', () => {
    const t = survival(2)
    t.place(0, 0, 0)
    t.sv(1).self.age = 9999
    const was = { ...t.sv(1).player.state.pos }
    t.social(0, { kind: 'party', op: 'join', code: 'GRAYBD' })
    t.social(1, { kind: 'party', op: 'join', code: 'GRAYBD' })
    expect(t.sv(1).player.state.pos).toEqual(was)
  })
})

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  encodeClientMessage,
  initPhysics,
  loadMap,
  mergeRules,
  PROTOCOL_VERSION,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
} from '@office-fps/shared'
import { AdminApi } from './admin.ts'
import { ErrorLog, errorLog } from './errors.ts'
import { Game } from './game.ts'
import { CLOSE_BANNED, CLOSE_KICKED, moderationOf } from './moderation.ts'
import { createSession } from './session.ts'

beforeAll(async () => {
  await initPhysics()
})

const PASSWORD = 'hunter2'

/** A fake browser: a session over a socket that records what it's sent and how it closed. */
function connect(game: Game, name: string, ip = '10.0.0.1') {
  const inbox: ServerMessage[] = []
  const closed: { code: number; reason: string }[] = []
  const session = createSession(
    game,
    {
      send: (b) => inbox.push(decodeServerMessage(b)),
      close: (code, reason) => {
        closed.push({ code, reason })
        session.close(code)
      },
    },
    () => 0,
    undefined,
    ip,
  )
  session.message(
    encodeClientMessage({ type: ClientMsg.Hello, protocolVersion: PROTOCOL_VERSION, name }),
  )
  return { session, inbox, closed, id: session.playerId }
}

function setup(survival = true) {
  const map = loadMap(survival ? 'deadwood' : 'office')
  const game = new Game(map, createPhysicsWorld(map), seeded(3))
  if (survival) game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const errors = new ErrorLog()
  const bans: unknown[] = []
  const admin = new AdminApi(game, {
    password: PASSWORD,
    errors,
    onBansChanged: (b) => bans.push(b),
  })
  const call = async (path: string, body?: unknown, password = PASSWORD) => {
    const res = await admin.handle(
      new Request(`http://office/admin/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'X-Admin-Password': encodeURIComponent(password),
          'CF-Connecting-IP': '9.9.9.9',
        },
        body: body === undefined ? null : JSON.stringify(body),
      }),
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  return { game, admin, call, errors, bans }
}

const selfOf = (inbox: ServerMessage[]): SurvivalSelf | undefined =>
  inbox.filter((m) => m.type === ServerMsg.Survival).at(-1)?.self

describe('admin moderation', () => {
  test('every tool needs the password', async () => {
    const { call, game } = setup(false)
    const alice = connect(game, 'Alice')
    // (After 5 wrong passwords the lockout answers 429 instead.)
    for (const path of ['kick', 'ban', 'unban', 'teleport', 'give', 'time', 'broadcast']) {
      expect([401, 429]).toContain((await call(path, { id: alice.id }, 'nope')).status)
    }
    expect((await call('errors', undefined, 'nope')).status).toBe(429)
    expect(game.players.has(alice.id)).toBe(true)
  })

  test('kick closes their connection with the reason, for good', async () => {
    const { call, game } = setup(false)
    const alice = connect(game, 'Alice')
    const res = await call('kick', { id: alice.id, reason: 'camping the spawn' })
    expect(res.status).toBe(200)
    expect(game.players.has(alice.id)).toBe(false)
    expect(alice.closed).toEqual([{ code: CLOSE_KICKED, reason: 'Kicked: camping the spawn' }])
    // Somebody already gone: 404.
    expect((await call('kick', { id: alice.id, reason: '' })).status).toBe(404)
  })

  test('ban keeps the name and the address out until lifted, and is reported for storing', async () => {
    const { call, game, bans } = setup(false)
    const alice = connect(game, 'Alice', '10.0.0.7')
    expect((await call('ban', { id: alice.id, reason: 'cheating' })).status).toBe(200)
    expect(alice.closed[0]?.code).toBe(CLOSE_BANNED)
    expect(bans).toHaveLength(1)

    const again = connect(game, 'alice', '10.0.0.8')
    expect(again.closed[0]).toEqual({ code: CLOSE_BANNED, reason: 'Banned: cheating' })
    const renamed = connect(game, 'Totally Not Alice', '10.0.0.7')
    expect(renamed.closed[0]?.code).toBe(CLOSE_BANNED)
    // Loopback (everyone, in local play) is never matched by address.
    expect(moderationOf(game).banned('Bob', '127.0.0.1')).toBeNull()

    const state = await call('state')
    expect((state.body.bans as { name: string }[]).map((b) => b.name)).toEqual(['Alice'])
    expect((await call('unban', { name: 'ALICE' })).status).toBe(200)
    expect(connect(game, 'Alice', '10.0.0.7').closed).toEqual([])
    expect((await call('unban', { name: 'Alice' })).status).toBe(404)
  })

  test('teleports to a place, and to another player', async () => {
    const { call, game } = setup()
    const alice = connect(game, 'Alice')
    const bob = connect(game, 'Bob')
    const haven = game.world.map.survival?.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    expect((await call('teleport', { id: alice.id, place: 'haven' })).status).toBe(200)
    const a = game.players.get(alice.id)?.state.pos
    expect(a && Math.hypot(a.x - haven.x, a.z - haven.z)).toBeLessThan(haven.r)

    const b = game.players.get(bob.id)
    if (!b) throw new Error('no bob')
    b.state.pos = { x: haven.x + 30, y: haven.y + 0.1, z: haven.z + 30 }
    expect((await call('teleport', { id: alice.id, to: bob.id })).status).toBe(200)
    const a2 = game.players.get(alice.id)?.state.pos
    expect(a2 && Math.hypot(a2.x - b.state.pos.x, a2.z - b.state.pos.z)).toBeLessThan(5)

    expect((await call('teleport', { id: alice.id, place: 'atlantis' })).status).toBe(404)
    expect((await call('teleport', { id: alice.id })).status).toBe(400)
    const places = (await call('state')).body.places as { key: string }[]
    expect(places.map((p) => p.key)).toContain('haven')
  })

  test('gives items into their pockets', async () => {
    const { call, game } = setup()
    const alice = connect(game, 'Alice')
    expect((await call('give', { id: alice.id, item: 'bandage', n: 3 })).status).toBe(200)
    game.step()
    const self = selfOf(alice.inbox)
    expect(self?.inv.filter((s) => s.item === 'bandage').reduce((n, s) => n + s.n, 0)).toBe(3)
    expect((await call('give', { id: alice.id, item: 'unicorn', n: 1 })).status).toBe(404)
  })

  test('give, time and start-over need survival', async () => {
    const { call, game } = setup(false)
    const alice = connect(game, 'Alice')
    expect((await call('give', { id: alice.id, item: 'bandage' })).status).toBe(400)
    expect((await call('time', { time: 0.5 })).status).toBe(400)
    expect((await call('reset-character', { id: alice.id })).status).toBe(400)
    expect((await call('state')).body.survival).toBeNull()
  })

  test('winds the clock to a time of day', async () => {
    const { call, game } = setup()
    connect(game, 'Alice')
    for (const t of [0.62, 0.15]) {
      const res = await call('time', { time: t })
      expect(res.status).toBe(200)
      const sv = res.body.survival as { time: number }
      expect(sv.time).toBeCloseTo(t, 5)
    }
  })

  test("starts someone's character over", async () => {
    const { call, game } = setup()
    const alice = connect(game, 'Alice')
    await call('give', { id: alice.id, item: 'bandage', n: 2 })
    expect((await call('reset-character', { id: alice.id })).status).toBe(200)
    game.step()
    const self = selfOf(alice.inbox)
    expect(self?.inv.some((s) => s.item === 'bandage')).toBe(false)
    expect(self?.inv.some((s) => s.item === 'water')).toBe(true)
    expect(game.players.get(alice.id)?.state.alive).toBe(true)
  })

  test('broadcasts a line to everyone', async () => {
    const { call, game } = setup()
    const alice = connect(game, 'Alice')
    const bob = connect(game, 'Bob')
    expect((await call('broadcast', { text: '  restart in 5  ' })).status).toBe(200)
    for (const c of [alice, bob]) {
      const notice = c.inbox.filter((m) => m.type === ServerMsg.Notice).at(-1)
      expect(notice?.type === ServerMsg.Notice && notice.notice.text).toBe('Server: restart in 5')
    }
    expect((await call('broadcast', { text: ' ' })).status).toBe(400)
  })
})

describe('error log', () => {
  test('keeps the last 50, newest first, counting repeats', () => {
    const log = new ErrorLog()
    for (let i = 0; i < 60; i++) log.add('tick', new Error(`boom ${i}`), undefined, i)
    expect(log.list()).toHaveLength(50)
    expect(log.list()[0]?.message).toBe('Error: boom 59')
    log.add('tick', new Error('boom 30'), 'again', 100)
    expect(log.list()[0]).toMatchObject({ message: 'Error: boom 30', count: 2, context: 'again' })
    expect(log.list()).toHaveLength(50)
  })

  test('takes client reports without a password, rate-limited, and lists them for the admin', async () => {
    const { admin, call, errors } = setup(false)
    const report = (message: unknown, ip = '1.1.1.1') =>
      admin.handle(
        new Request('http://office/admin/api/client-error', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': ip },
          body: JSON.stringify({ message, where: 'main.ts:1:2' }),
        }),
        1000,
      )
    const ok = await report('TypeError: x is undefined')
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true)
    for (let i = 0; i < 20; i++) await report(`spam ${i}`)
    expect(errors.list().filter((e) => e.source === 'client')).toHaveLength(10)
    // Someone else still gets through; junk doesn't.
    await report('another', '2.2.2.2')
    await report(42, '3.3.3.3')
    const listed = (await call('errors')).body.errors as { source: string; context?: string }[]
    expect(listed).toHaveLength(11)
    expect(listed[0]?.context).toBe('main.ts:1:2')
  })

  test('a message that breaks the game is logged, and the session carries on', () => {
    const { game } = setup(false)
    const alice = connect(game, 'Alice')
    const original = game.handleAction.bind(game)
    game.handleAction = () => {
      throw new Error('kaboom')
    }
    alice.session.message(
      encodeClientMessage({ type: ClientMsg.Action, action: { a: 'light', on: true } }),
    )
    game.handleAction = original
    const logged = errorLog.list().find((e) => e.message === 'Error: kaboom')
    expect(logged).toMatchObject({ source: 'session', context: `player #${alice.id} "Alice"` })
    expect(game.players.has(alice.id)).toBe(true)
  })
})

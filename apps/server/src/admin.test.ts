import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  decodeServerMessage,
  type GameRules,
  initPhysics,
  loadMap,
  ServerMsg,
} from '@office-fps/shared'
import { AdminApi } from './admin.ts'
import { Game } from './game.ts'

beforeAll(async () => {
  await initPhysics()
})

function setup(password = 'hunter2') {
  const map = loadMap('office')
  const game = new Game(map, createPhysicsWorld(map))
  const saved: GameRules[] = []
  const admin = new AdminApi(game, { password, onRulesChanged: (r) => saved.push(r) })
  return { game, admin, saved }
}

function request(path: string, password: string, body?: unknown, ip = '1.2.3.4') {
  return new Request(`http://office/admin/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Admin-Password': encodeURIComponent(password), 'CF-Connecting-IP': ip },
    body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('admin API', () => {
  test('is disabled without a password', async () => {
    const { admin } = setup('')
    expect((await admin.handle(request('state', ''))).status).toBe(503)
  })

  test('rejects a wrong password and accepts the right one', async () => {
    const { admin } = setup()
    expect((await admin.handle(request('state', 'nope'))).status).toBe(401)
    const ok = await admin.handle(request('state', 'hunter2'))
    expect(ok.status).toBe(200)
    const state = (await ok.json()) as { rules: GameRules; choices: { maps: { id: string }[] } }
    expect(state.rules.map).toBe('office')
    expect(state.choices.maps.map((m) => m.id)).toContain('gym')
  })

  test("lists who's playing, not survival's dead", async () => {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map))
    game.join('Alice', { send: () => {} })
    const admin = new AdminApi(game, { password: 'hunter2' })
    const state = (await (await admin.handle(request('state', 'hunter2'))).json()) as {
      players: { name: string }[]
    }
    expect(state.players.map((p) => p.name)).toEqual(['Alice'])
  })

  test('locks a client out after 5 wrong passwords, even with the right one', async () => {
    const { admin } = setup()
    const now = 1_000_000
    for (let i = 0; i < 5; i++) await admin.handle(request('state', 'guess'), now)
    expect((await admin.handle(request('state', 'hunter2'), now)).status).toBe(429)
    // Someone else (another IP) is unaffected, and the lockout ends.
    expect(
      (await admin.handle(request('state', 'hunter2', undefined, '5.6.7.8'), now)).status,
    ).toBe(200)
    expect((await admin.handle(request('state', 'hunter2'), now + 11 * 60_000)).status).toBe(200)
  })

  test('applies rule changes live, clamped, and reports them for saving', async () => {
    const { admin, game, saved } = setup()
    const client = {
      inbox: [] as ReturnType<typeof decodeServerMessage>[],
      send(b: Uint8Array) {
        this.inbox.push(decodeServerMessage(b))
      },
    }
    game.join('Anna', client)
    const res = await admin.handle(
      request('rules', 'hunter2', { gravity: 99, oneShot: true, hack: 1 }),
    )
    expect(res.status).toBe(200)
    expect(game.rules.gravity).toBe(2)
    expect(game.rules.oneShot).toBe(true)
    expect(saved.at(-1)?.oneShot).toBe(true)
    const rules = client.inbox.filter((m) => m.type === ServerMsg.Rules).at(-1)
    expect(rules?.type === ServerMsg.Rules && rules.rules.gravity).toBe(2)
  })

  test('switches map', async () => {
    const { admin, game } = setup()
    await admin.handle(request('rules', 'hunter2', { map: 'gym' }))
    expect(game.mapId).toBe('gym')
    await admin.handle(request('rules', 'hunter2', { map: 'nowhere' }))
    expect(game.mapId).toBe('gym')
  })

  test('accepts passwords with æøå and ignores stray spaces around them', async () => {
    const { admin } = setup('Rødgrød med fløde ')
    const res = await admin.handle(request('state', ' Rødgrød med fløde'))
    expect(res.status).toBe(200)
  })

  test('ignores terminal paste markers and control characters stored in the secret', async () => {
    const { admin } = setup('\u001b[200~office-admin\u001b[201~\r\n')
    expect((await admin.handle(request('state', 'office-admin'))).status).toBe(200)
  })

  test('rejects a body that is not JSON', async () => {
    const { admin } = setup()
    expect((await admin.handle(request('rules', 'hunter2', '{oops'))).status).toBe(400)
  })
})

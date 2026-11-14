import { beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  initPhysics,
  loadMap,
  mergeRules,
  type ServerMessage,
  ServerMsg,
  SnapshotCodec,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { Game } from './game.ts'
import { FAR_EVERY } from './interest.ts'

beforeAll(async () => {
  await initPhysics()
})

type Snapshot = Extract<ServerMessage, { type: typeof ServerMsg.Snapshot }>

/** Deadwood survival with clients that read deltas and acknowledge like the real one. */
function setup(n: number) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(3))
  const clients = Array.from({ length: n }, () => {
    const codec = new SnapshotCodec()
    const snaps: Snapshot[] = []
    let bytes = 0
    return {
      codec,
      snaps,
      get bytes() {
        return bytes
      },
      send(b: Uint8Array) {
        const msg = decodeServerMessage(b, codec)
        if (msg.type === ServerMsg.Snapshot) {
          snaps.push(msg)
          bytes += b.byteLength
        }
      },
    }
  })
  const ids = clients.map((c, i) => game.join(`P${i}`, c) ?? 0)
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const place = (i: number, x: number, z: number) => {
    const p = game.players.get(ids[i] ?? 0)
    if (!p) throw new Error('no player')
    p.state.pos = { x, y: 0, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = Number.POSITIVE_INFINITY
  }
  const run = (ticks: number) => {
    for (let t = 0; t < ticks; t++) {
      game.step()
      // Every client acks the newest snapshot it has read (no inputs: they stand still).
      clients.forEach((c, i) => {
        const last = c.snaps.at(-1)
        if (last) game.handleInput(ids[i] ?? 0, [], last.tick)
      })
    }
  }
  return { game, clients, ids, place, run }
}

describe('area of interest in the game', () => {
  test('two players far apart only see each other now and then; further still, not at all', () => {
    const t = setup(2)
    t.place(0, 0, 0)
    t.place(1, 350, 0)
    t.run(TICK_RATE) // settle
    const a = t.clients[0]
    if (!a) throw new Error('no client')
    const from = a.snaps.length
    t.run(TICK_RATE * 2)
    const window = a.snaps.slice(from)
    const seen = window.filter((s) => s.players.some((p) => p.id === t.ids[1])).length
    // ~5 Hz instead of 30.
    expect(seen).toBeGreaterThan(0)
    expect(seen).toBeLessThanOrEqual(Math.ceil(window.length / FAR_EVERY) + 1)
    // Deltas are in use (the clients ack) and decode to the right place.
    expect(window.some((s) => s.baseTick)).toBe(true)
    const b = window.flatMap((s) => s.players).find((p) => p.id === t.ids[1])
    expect(b?.x).toBeCloseTo(350, 3)

    // Walk away past the far ring: one removal, then never again.
    t.place(1, 900, 0)
    const before = a.snaps.length
    t.run(10)
    const after = a.snaps.slice(before)
    expect(after.filter((s) => s.removed?.includes(t.ids[1] ?? 0)).length).toBe(1)
    expect(after.some((s) => s.players.some((p) => p.id === t.ids[1]))).toBe(false)

    // Back close: sent at once and every snapshot.
    t.place(1, 30, 0)
    const back = a.snaps.length
    t.run(20)
    const near = a.snaps.slice(back)
    expect(near.every((s) => s.players.some((p) => p.id === t.ids[1]))).toBe(true)
    expect(near[0]?.players.find((p) => p.id === t.ids[1])?.x).toBeCloseTo(30, 3)
  })

  test('zombies far from you are not sent', () => {
    const t = setup(2)
    t.place(0, 0, 0)
    t.place(1, 900, 900)
    t.run(TICK_RATE * 3)
    const a = t.clients[0]
    const me = t.game.players.get(t.ids[0] ?? 0)?.state.pos ?? { x: 0, z: 0 }
    for (const s of a?.snaps.slice(-30) ?? []) {
      for (const p of s.players) {
        const zombie = t.game.players.get(p.id)?.zombie
        if (zombie) expect(Math.hypot(p.x - me.x, p.z - me.z)).toBeLessThan(230)
      }
    }
  })
})

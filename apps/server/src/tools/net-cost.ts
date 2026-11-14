/**
 * Measures what snapshots cost: bytes per second per client and server time per snapshot, with
 * 8 walking players in Deadwood survival (spread over the map, or all together in Haven).
 * In-process (no sockets); clients read snapshots and acknowledge them ~100 ms late, with
 * inputs batched like the real client.
 *
 *   bun apps/server/src/tools/net-cost.ts [spread|haven] [seconds]
 */
import * as shared from '@office-fps/shared'
import { Game } from '../game.ts'

const {
  Button,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  heightAt,
  INPUT_BATCH_TICKS,
  initPhysics,
  loadMap,
  mergeRules,
  ServerMsg,
  seeded,
  TICK_RATE,
} = shared
// Older builds have no delta codec: they then read every snapshot whole.
const Codec = (shared as { SnapshotCodec?: new () => unknown }).SnapshotCodec

const layout = process.argv[2] ?? 'spread'
const seconds = Number(process.argv[3] ?? 10)
const SPREAD: [number, number][] = [
  [0, 40],
  [420, 0],
  [-400, 320],
  [800, -600],
  [-900, -700],
  [1100, 900],
  [200, -1100],
  [-1200, 500],
]
const HAVEN: [number, number][] = SPREAD.map((_, i) => [
  Math.cos(i) * (6 + i * 2),
  Math.sin(i) * (6 + i * 2),
])
/** Acks reach the server this many ticks late (~100 ms). */
const ACK_DELAY = 6

await initPhysics()
const map = loadMap('deadwood')
const game = new Game(map, createPhysicsWorld(map), seeded(11))
let measuring = false
const clients = (layout === 'haven' ? HAVEN : SPREAD).map(() => {
  const codec = Codec ? new Codec() : undefined
  const c = {
    bytes: 0,
    snapBytes: 0,
    snaps: 0,
    players: 0,
    acks: [] as { at: number; tick: number }[],
    inbox: [] as Uint8Array[],
    /** Kept for later, so reading them isn't counted as server time. */
    send(b: Uint8Array) {
      c.inbox.push(b)
    },
    read() {
      for (const b of c.inbox.splice(0)) c.receive(b)
    },
    receive(b: Uint8Array) {
      // biome-ignore lint/suspicious/noExplicitAny: works against old and new builds
      const msg = (decodeServerMessage as any)(b, codec)
      if (measuring) c.bytes += b.byteLength
      if (msg.type === ServerMsg.Snapshot) {
        c.acks.push({ at: game.tick + ACK_DELAY, tick: msg.tick })
        if (measuring) {
          c.snapBytes += b.byteLength
          c.snaps++
          c.players += msg.players.length
        }
      }
    },
  }
  return c
})
const ids = clients.map((c, i) => game.join(`P${i}`, c) ?? 0)
game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
const spots = layout === 'haven' ? HAVEN : SPREAD
ids.forEach((id, i) => {
  const p = game.players.get(id)
  const [x, z] = spots[i] ?? [0, 0]
  if (!p) return
  p.state.pos = { x, y: (map.survival ? heightAt(map.survival.terrain, x, z) : 0) + 0.2, z }
  p.state.vel = { x: 0, y: 0, z: 0 }
  p.protectedUntil = Number.POSITIVE_INFINITY
})

// Time each snapshot round (works whatever the method does inside).
const g = game as unknown as { sendSnapshots: () => void }
const original = g.sendSnapshots.bind(game)
let snapMs = 0
let snapCalls = 0
g.sendSnapshots = () => {
  const t0 = performance.now()
  original()
  if (measuring) {
    snapMs += performance.now() - t0
    snapCalls++
  }
}

let seq = 1
const pending = ids.map(() => [] as shared.InputCommand[])
let stepMs = 0
let steps = 0
const run = (ticks: number) => {
  for (let t = 0; t < ticks; t++) {
    ids.forEach((id, i) => {
      const p = game.players.get(id)
      if (p) p.health = 100 // keep everyone up and walking
      // Walk in slow circles, sprinting now and then.
      const yaw = (game.tick / TICK_RATE) * 0.4 + i
      const buttons =
        Button.Forward | (Math.floor(game.tick / 300 + i) % 3 === 0 ? Button.Sprint : 0)
      pending[i]?.push({ seq: seq++, buttons, yaw, pitch: 0, viewTick: game.tick })
      if (game.tick % INPUT_BATCH_TICKS === 0) {
        const c = clients[i]
        let ack = 0
        while (c && (c.acks[0]?.at ?? Number.POSITIVE_INFINITY) <= game.tick) {
          ack = c.acks.shift()?.tick ?? ack
        }
        // biome-ignore lint/suspicious/noExplicitAny: older builds take no ack
        ;(game.handleInput as any).call(game, id, pending[i]?.splice(0) ?? [], ack)
      }
    })
    const t0 = performance.now()
    game.step()
    if (measuring) {
      stepMs += performance.now() - t0
      steps++
    }
    for (const c of clients) c.read()
  }
}

run(TICK_RATE * 20) // let the woods fill up
measuring = true
run(TICK_RATE * seconds)
const zombies = [...game.players.values()].filter((p) => p.zombie)
const per = clients.map((c) => Math.round(c.bytes / seconds))
const snapPer = clients.map((c) => Math.round(c.snapBytes / seconds))
const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
console.log(
  JSON.stringify(
    {
      layout,
      codec: Boolean(Codec),
      entities: game.players.size,
      zombiesAlive: zombies.filter((z) => z.state.alive).length,
      zombieSlots: zombies.length,
      bytesPerSecPerClient: { avg: avg(per), min: Math.min(...per), max: Math.max(...per) },
      snapshotBytesPerSecPerClient: avg(snapPer),
      avgPlayersPerSnapshot: +(
        clients.reduce((a, c) => a + c.players, 0) / clients.reduce((a, c) => a + c.snaps, 0)
      ).toFixed(1),
      snapshotMsPerRound: +(snapMs / snapCalls).toFixed(3),
      tickMs: +(stepMs / steps).toFixed(3),
    },
    null,
    1,
  ),
)

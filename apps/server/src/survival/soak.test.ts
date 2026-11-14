import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  type ClientMessage,
  ClientMsg,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  encodeClientMessage,
  ITEMS,
  initPhysics,
  loadMap,
  MAX_PLAYERS,
  mergeRules,
  PROTOCOL_VERSION,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  WEATHER_KINDS,
} from '@office-fps/shared'
import { errorLog } from '../errors.ts'
import { Game } from '../game.ts'
import { moderationOf } from '../moderation.ts'
import { createSession, type Session } from '../session.ts'

/**
 * Soak test: Deadwood survival with up to 8 simulated people (seeded random input: walking,
 * shooting, E, the backpack, junk actions) joining and leaving, the admin poking at them, and the
 * full pool of the dead, for SOAK_SECONDS of game time (`bun run soak`: 5 minutes; the normal
 * `bun test` run does a short one). Checks nothing throws, the server never overfills, the
 * director's pool stays real, ticks stay inside the budget and memory doesn't keep growing.
 */
const SECONDS = Number(process.env.SOAK_SECONDS ?? 30)
/** p99 tick budget (ms): one tick must fit in the 60 Hz step with room for sockets and GC. */
const P99_BUDGET_MS = Number(process.env.SOAK_P99_MS ?? 1000 / TICK_RATE)
/** Heap growth allowed between the end of warm-up and the end (MB). */
const HEAP_BUDGET_MB = 64
const PEOPLE = 8
const WARMUP_SECONDS = Math.min(20, SECONDS / 4)

beforeAll(async () => {
  await initPhysics()
})

// The director and weapon seeds use Math.random: the test seeds it (so a run can be repeated).
const realRandom = Math.random
afterEach(() => {
  Math.random = realRandom
})

interface Sim {
  name: string
  session: Session
  /** Raw messages since the last check (only the watcher's are decoded). */
  inbox: Uint8Array[]
  closed: boolean
  seq: number
  yaw: number
  pitch: number
  /** Buttons held for a while (walking somewhere), and until which tick. */
  held: number
  heldUntil: number
  self: SurvivalSelf | null
}

const pct = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
const mb = (bytes: number) => bytes / (1024 * 1024)

describe('soak', () => {
  test(
    `Deadwood with ${PEOPLE} people and the dead for ${SECONDS} s`,
    async () => {
      const rand = seeded(20)
      Math.random = seeded(22)
      errorLog.clear() // (other test files share the process-wide log)
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
      const map = loadMap('deadwood')
      const game = new Game(map, createPhysicsWorld(map), seeded(21))
      game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
      const moderation = moderationOf(game)
      const places = moderation.places().map((p) => p.key)
      const items = Object.values(ITEMS)
        .filter((d) => d.kind !== 'money' && d.kind !== 'quest')
        .map((d) => d.id)

      const sims = new Map<string, Sim>()
      let watcher = null as Sim | null
      let decoded = 0
      let bytesOut = 0

      const join = (name: string) => {
        const sim: Sim = {
          name,
          session: null as unknown as Session,
          inbox: [],
          closed: false,
          seq: 1,
          yaw: rand() * Math.PI * 2,
          pitch: 0,
          held: 0,
          heldUntil: 0,
          self: null,
        }
        sim.session = createSession(
          game,
          {
            send: (b) => {
              bytesOut += b.byteLength
              if (sim === watcher) sim.inbox.push(b)
            },
            close: () => {
              sim.closed = true
            },
          },
          () => 0,
          { ip: `10.0.0.${sims.size + 1}` },
        )
        send(sim, { type: ClientMsg.Hello, protocolVersion: PROTOCOL_VERSION, name })
        sims.set(name, sim)
        watcher ??= sim
      }
      const leave = (sim: Sim) => {
        sim.session.close(1000)
        sims.delete(sim.name)
        if (watcher === sim) watcher = null
      }
      const send = (sim: Sim, msg: ClientMessage) => sim.session.message(encodeClientMessage(msg))

      /** One tick of a person's input: mostly walking about, now and then the rest. */
      const play = (sim: Sim) => {
        const tick = game.tick
        if (tick >= sim.heldUntil) {
          sim.held =
            pick([Button.Forward, Button.Forward | Button.Sprint, Button.Left, Button.Back, 0]) |
            (rand() < 0.1 ? Button.Crouch : 0)
          sim.heldUntil = tick + Math.floor(rand() * 3 * TICK_RATE)
          sim.yaw += (rand() - 0.5) * 2
          sim.pitch = (rand() - 0.5) * 0.6
        }
        let buttons = sim.held
        const r = rand()
        if (r < 0.05) buttons |= Button.Fire
        else if (r < 0.06) buttons |= Button.Use
        else if (r < 0.065) buttons |= Button.Jump
        else if (r < 0.068) buttons |= Button.Reload
        else if (r < 0.07) buttons |= pick([Button.Slot1, Button.Slot2, Button.Slot3])
        else if (r < 0.072) buttons |= Button.Aim
        send(sim, {
          type: ClientMsg.Input,
          commands: [
            { seq: sim.seq++, buttons, yaw: sim.yaw, pitch: sim.pitch, viewTick: tick - 6 },
          ],
        })
        // The backpack, the shop, the torch, and junk a broken (or hostile) client might send.
        if (rand() < 0.004) {
          const stack = sim.self?.inv.length ? pick(sim.self.inv) : null
          const ref = stack ? { c: stack.c, x: stack.x, y: stack.y } : { c: 0, x: 0, y: 0 }
          const action = pick([
            { a: 'use', from: ref },
            { a: 'move', from: ref, to: { ground: true } },
            { a: 'move', from: ref, to: { auto: true }, n: 1 },
            { a: 'light', on: rand() < 0.5 },
            { a: 'buy', item: pick(items), n: 1 },
            { a: 'sell', item: pick(items), n: 1 },
            { a: 'choose', npc: 'gus', option: 'bye' },
            { a: 'use', from: { slot: 'primary' } },
            { a: 'move', from: { c: 9, x: -4, y: 99 }, to: { slot: 'nonsense' } },
            { a: 'zap' },
          ])
          send(sim, { type: ClientMsg.Action, action: action as never })
        }
        if (tick % TICK_RATE === 0) send(sim, { type: ClientMsg.Ping, clientTime: 0, rtt: 40 })
      }

      /** The admin now and then: teleports, gifts, the clock, the weather, a kick or a ban. */
      const administer = (): string => {
        const people = [...game.players.values()].filter((p) => !p.zombie && !p.bot)
        const someone = people.length ? pick(people) : null
        const r = rand()
        if (someone && r < 0.35) {
          const place = pick(places)
          moderation.teleport(someone.id, { place })
          return `teleport ${place}`
        }
        if (someone && r < 0.45 && people.length > 1) {
          moderation.teleport(someone.id, { to: pick(people).id })
          return 'teleport to player'
        }
        if (someone && r < 0.65) {
          moderation.give(someone.id, pick(items), (1 + rand() * 5) | 0)
          return 'give'
        }
        if (r < 0.72) {
          moderation.setTime(rand())
          return 'time'
        }
        if (r < 0.78) {
          game.match.pinWeather(rand() < 0.5 ? null : pick(WEATHER_KINDS))
          return 'weather'
        }
        if (someone && r < 0.83) {
          moderation.resetCharacter(someone.id)
          return 'reset'
        }
        if (someone && r < 0.88) {
          moderation.kick(someone.id, 'soak')
          return 'kick'
        }
        if (someone && r < 0.9) {
          moderation.ban(someone.id, 'soak')
          moderation.unban(someone.name)
          return 'ban'
        }
        moderation.broadcast('Still standing.')
        return 'broadcast'
      }

      const ticks = SECONDS * TICK_RATE
      const warmup = WARMUP_SECONDS * TICK_RATE
      const times: number[] = []
      let worst = { ms: 0, tick: 0 }
      let peak = 0
      /** Most of the dead up and about at once. */
      let peakDead = 0
      const heap: number[] = []
      /** The director's own records: these must not keep piling up either. */
      const collections = () => {
        const d = game.match.survivalDirector as unknown as Record<string, Map<unknown, unknown>>
        return {
          loot: d.loot?.size ?? 0,
          cells: d.cells?.size ?? 0,
          profiles: d.profiles?.size ?? 0,
          turned: d.turned?.size ?? 0,
          zeds: d.zeds?.size ?? 0,
          items: game.items.items.size,
        }
      }
      const sizes: ReturnType<typeof collections>[] = []
      let names = 0
      for (let i = 0; i < 4; i++) join(`Soak ${names++}`)
      await Bun.sleep(5)

      for (let t = 0; t < ticks; t++) {
        // Joining reads a save first (async): let pending joins land now and then.
        if (t % 6 === 0) await Bun.sleep(0)
        // People come and go (sometimes the same name again: they get their things back).
        if (rand() < 1 / (8 * TICK_RATE)) {
          if (sims.size < PEOPLE && (sims.size < 2 || rand() < 0.6))
            join(
              rand() < 0.3 && names > 0 ? `Soak ${Math.floor(rand() * names)}` : `Soak ${names++}`,
            )
          else if (sims.size > 0) leave(pick([...sims.values()]))
        }
        for (const sim of [...sims.values()]) {
          // Kicked (or turned away): gone, like a closed tab.
          if (sim.closed || !sim.session.playerId) leave(sim)
          else play(sim)
        }
        let did = ''
        if (rand() < 1 / (5 * TICK_RATE)) did = administer()

        const start = performance.now()
        game.step()
        const ms = performance.now() - start
        if (t >= warmup) times.push(ms)
        if (ms > worst.ms) worst = { ms, tick: game.tick }
        if (process.env.SOAK_TRACE && ms > 12)
          console.log(`[soak] slow tick ${game.tick}: ${ms.toFixed(1)} ms ${did}`)

        expect(game.players.size).toBeLessThanOrEqual(MAX_PLAYERS)
        peak = Math.max(peak, game.players.size)
        if (t % 30 === 0) {
          let up = 0
          for (const p of game.players.values()) if (p.zombie && p.state.alive) up++
          peakDead = Math.max(peakDead, up)
        }
        // What the watcher was told decodes (outside the timing).
        if (watcher) {
          for (const raw of watcher.inbox) {
            const msg = decodeServerMessage(raw)
            decoded++
            if (msg.type === ServerMsg.Survival) watcher.self = msg.self
          }
          watcher.inbox.length = 0
        }

        if (t % TICK_RATE === 0) {
          // The director's pool: every one of the dead it runs is in the game, once.
          const director = game.match.survivalDirector
          expect(director).not.toBeNull()
          const pool = director?.poolIds ?? []
          expect(new Set(pool).size).toBe(pool.length)
          for (const id of pool) expect(game.players.get(id)?.zombie).toBeDefined()
          // Everyone the sims think is in, is.
          for (const sim of sims.values())
            if (sim.session.playerId) expect(game.players.has(sim.session.playerId)).toBe(true)
        }
        if (t === warmup || (t > warmup && t % (10 * TICK_RATE) === 0) || t === ticks - 1) {
          Bun.gc(true)
          heap.push(mb(process.memoryUsage().heapUsed))
          sizes.push(collections())
        }
      }

      times.sort((a, b) => a - b)
      const p50 = pct(times, 0.5)
      const p99 = pct(times, 0.99)
      // The heap saws up and down between collections: compare the low points of each half.
      const half = Math.ceil(heap.length / 2)
      const growth = Math.min(...heap.slice(half)) - Math.min(...heap.slice(0, half))
      const pool = game.match.survivalDirector?.poolIds.length ?? 0
      console.log(
        `[soak] ${SECONDS} s, ${ticks} ticks · tick p50 ${p50.toFixed(2)} ms · p99 ${p99.toFixed(2)} ms · ` +
          `max ${worst.ms.toFixed(2)} ms (tick ${worst.tick}) · peak ${peak} players · ${peakDead} dead up · pool ${pool} · ` +
          `${names} names · ${(bytesOut / 1e6).toFixed(1)} MB sent · ${decoded} msgs decoded · ` +
          `heap ${heap.map((h) => h.toFixed(0)).join(' → ')} MB (growth ${growth.toFixed(1)} MB)`,
      )
      console.log(
        `[soak] records first → last: ${JSON.stringify(sizes[0])} → ${JSON.stringify(sizes.at(-1))}`,
      )
      // Messages the session caught throwing (logged, not fatal) count as failures here.
      expect(errorLog.list().map((e) => `${e.source}: ${e.message}`)).toEqual([])
      expect(p99).toBeLessThan(P99_BUDGET_MS)
      expect(growth).toBeLessThan(HEAP_BUDGET_MB)
      expect(pool).toBeGreaterThan(0)
      expect(peakDead).toBeGreaterThan(0)
    },
    Math.max(120_000, SECONDS * 2000),
  )
})

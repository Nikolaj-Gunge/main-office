import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  CRANK_SECS,
  createPhysicsWorld,
  DEFAULT_RULES,
  GATE_BROKEN_SECS,
  GATE_HOLD_SECS,
  GATE_HP,
  gateNight,
  HAVEN_CRANK,
  HAVEN_GATE,
  HAVEN_WALL,
  initPhysics,
  loadMap,
  mergeRules,
  PLAYER_QUERY_GROUPS,
  RAPIER,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { SurvivalDirector } from './director.ts'
import { type GateHost, HavenGate } from './haven-gate.ts'

beforeAll(async () => {
  await initPhysics()
})

const HAVEN = { x: 0, y: 0, z: 0 }
const DT = 1 / TICK_RATE

/** Somebody (or one of the dead) standing at (x, z). */
function body(id: number, x: number, z: number, name = `P${id}`): ServerPlayer {
  return {
    id,
    name,
    state: { pos: { x, y: 0, z }, alive: true, prevButtons: 0 },
  } as unknown as ServerPlayer
}

/** A gate with a fake world: the clock, who's about, and what it said and did. */
function rig(time = 0.1) {
  const w = {
    now: 0,
    time,
    people: [] as ServerPlayer[],
    zombies: [] as ServerPlayer[],
    opens: [] as boolean[],
    alerts: 0,
    notices: [] as string[],
  }
  const host: GateHost = {
    now: () => w.now,
    time: () => w.time,
    haven: () => HAVEN,
    people: () => w.people,
    zombies: () => w.zombies,
    setOpen: (open) => w.opens.push(open),
    broadcast: () => {},
    alert: () => w.alerts++,
    notice: (_p, _k, text) => w.notices.push(text),
  }
  const gate = new HavenGate(host)
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
      w.now += DT
      gate.step(DT)
    }
  }
  return { w, gate, run }
}

/** Somebody at the winch, holding E (or not). */
function atWinch(id = 1) {
  const p = body(id, HAVEN_CRANK[0] + 0.8, HAVEN_CRANK[1])
  p.state.prevButtons = Button.Use
  return p
}

describe('haven gate: day and night', () => {
  test('shut from nightfall to dawn, open by day', () => {
    expect(gateNight(0.05)).toBe(true)
    expect(gateNight(0.97)).toBe(true)
    expect(gateNight(0.5)).toBe(false)
    expect(gateNight(0.9)).toBe(false)
    const { w, gate, run } = rig(0.6)
    run(1)
    expect(gate.open).toBe(true)
    w.time = 0.97
    run(1)
    expect(gate.open).toBe(false)
    expect(w.opens).toEqual([false])
    w.time = 0.45
    run(1)
    expect(gate.open).toBe(true)
  })

  test("it won't drop on somebody standing in the gateway", () => {
    const { w, gate, run } = rig(0.6)
    run(0.1)
    w.people.push(body(1, 0.5, -HAVEN_WALL + 0.2))
    w.time = 0.97
    run(2)
    expect(gate.open).toBe(true)
    const p = w.people[0]
    if (p) p.state.pos.z = -HAVEN_WALL + 3
    run(0.1)
    expect(gate.open).toBe(false)
  })

  test('the winch does nothing by day', () => {
    const { w, gate } = rig(0.6)
    gate.use(atWinch())
    expect(w.notices.at(-1)).toContain('open by day')
  })
})

describe('haven gate: the winch', () => {
  test('held for CRANK_SECS it goes up, loudly; let go and it drops shut a while later', () => {
    const { w, gate, run } = rig()
    run(0.5)
    expect(gate.open).toBe(false)
    const p = atWinch()
    w.people.push(p)
    gate.use(p)
    run(CRANK_SECS - 0.5)
    expect(gate.open).toBe(false)
    expect(gate.shown()).toBeGreaterThan(50)
    run(0.7)
    expect(gate.open).toBe(true)
    // The chain is heard: the dead come to look.
    expect(w.alerts).toBeGreaterThanOrEqual(2)
    p.state.prevButtons = 0
    run(GATE_HOLD_SECS - 1)
    expect(gate.open).toBe(true)
    run(2)
    expect(gate.open).toBe(false)
    expect(gate.shown()).toBe(0)
  })

  test('let go early and it slides back; walk away and it stops', () => {
    const { w, gate, run } = rig()
    const p = atWinch()
    w.people.push(p)
    gate.use(p)
    run(CRANK_SECS / 2)
    const half = gate.crank
    expect(half).toBeGreaterThan(0.4)
    p.state.prevButtons = 0
    run(1)
    expect(gate.crank).toBeLessThan(half)
    // Back on it, but out of reach.
    p.state.prevButtons = Button.Use
    gate.use(p)
    p.state.pos.x += 5
    run(CRANK_SECS * 2)
    expect(gate.open).toBe(false)
  })

  test('one at a time on the winch', () => {
    const { w, gate } = rig()
    const a = atWinch(1)
    const b = atWinch(2)
    w.people.push(a, b)
    gate.use(a)
    gate.use(b)
    expect(w.notices.at(-1)).toContain('already on the winch')
  })

  test('banging on it from outside: everyone inside hears, and so do the dead', () => {
    const { w, gate, run } = rig()
    run(0.1)
    const out = body(1, 0, -HAVEN_WALL - 1, 'Ellen')
    const inside = body(2, 2, -10)
    const far = body(3, 300, 300)
    w.people.push(out, inside, far)
    gate.knock(out)
    expect(w.alerts).toBe(1)
    expect(w.notices.filter((n) => n.includes('Ellen is banging')).length).toBe(1)
    // Not again at once.
    gate.knock(out)
    expect(w.alerts).toBe(1)
  })
})

describe('haven gate: the dead batter it', () => {
  test('enough of them at it break it open for a while, then it drops shut again', () => {
    const { w, gate, run } = rig()
    run(0.1)
    for (let i = 0; i < 8; i++) w.zombies.push(body(100 + i, -2 + i * 0.5, -HAVEN_WALL - 1))
    run(GATE_HP / (8 * 6) + 1.5)
    expect(gate.open).toBe(true)
    expect(gate.broken).toBe(true)
    expect(w.notices.length).toBe(0) // nobody near to hear it
    // The winch won't wind a broken gate.
    const p = atWinch()
    w.people.push(p)
    gate.use(p)
    expect(w.notices.at(-1)).toContain('off its chain')
    w.zombies.length = 0
    run(GATE_BROKEN_SECS + 1)
    expect(gate.open).toBe(false)
    expect(gate.hp).toBeGreaterThan(0)
  })
})

describe('haven gate in Deadwood', () => {
  test('the gate is solid at night, gone by day, and the winch opens it (server)', () => {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(7))
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    const director = (game.match as unknown as { survival: SurvivalDirector }).survival
    const haven = map.survival?.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    const physics = game.world.physics
    expect(physics.gates.get(HAVEN_GATE)?.length).toBeGreaterThan(0)
    const solid = () => {
      const ray = new RAPIER.Ray(
        { x: haven.x, y: haven.y + 1.2, z: haven.z - HAVEN_WALL - 2 },
        {
          x: 0,
          y: 0,
          z: 1,
        },
      )
      return physics.world.castRay(ray, 4, true, undefined, PLAYER_QUERY_GROUPS) !== null
    }
    // A new world starts in the night.
    for (let i = 0; i < 5; i++) game.step()
    expect(director.gate.open).toBe(false)
    expect(solid()).toBe(true)
    expect((director.info().gates >> HAVEN_GATE) & 1).toBe(0)
    // Somebody at the winch, holding E.
    const id = game.join('P0', { send: () => {} })
    const p = game.players.get(id ?? -1)
    if (!p) throw new Error('no player')
    p.state.pos = {
      x: haven.x + HAVEN_CRANK[0] + 0.8,
      y: haven.y + 0.05,
      z: haven.z + HAVEN_CRANK[1],
    }
    director.gate.use(p)
    for (let t = 0; t < (CRANK_SECS + 0.5) * TICK_RATE; t++) {
      p.queue.push({ seq: t + 1, buttons: Button.Use, yaw: 0, pitch: 0, viewTick: game.tick })
      game.step()
    }
    expect(director.gate.open).toBe(true)
    expect(solid()).toBe(false)
    expect((director.info().gates >> HAVEN_GATE) & 1).toBe(1)
  })
})

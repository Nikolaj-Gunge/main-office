import { beforeAll, describe, expect, test } from 'bun:test'
import {
  buildDeadwood,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  FLOOD_RISE,
  heightAt,
  initPhysics,
  JETTY_ABOVE,
  loadMap,
  mergeRules,
  PRINT_SECONDS,
  type ServerMessage,
  ServerMsg,
  seeded,
  TICK_RATE,
  ZombieKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { Footprints } from './footprints.ts'
import type { Zed } from './horde.ts'
import {
  alongRoute,
  detour,
  MIGRATION_MIN,
  planMigration,
  routeLength,
  type Spot,
} from './migration.ts'
import type { WeatherWorld } from './weather-world.ts'

beforeAll(async () => {
  await initPhysics()
})

/** How near a route's legs come to a point (m). */
function nearestPass(route: readonly Spot[], c: Spot): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Spot
    const b = route[i] as Spot
    for (let t = 0; t <= 1; t += 0.01) {
      best = Math.min(best, Math.hypot(a.x + (b.x - a.x) * t - c.x, a.z + (b.z - a.z) * t - c.z))
    }
  }
  return best
}

describe('fog migrations', () => {
  const def = buildDeadwood().survival
  if (!def) throw new Error('no survival world')
  const haven = def.pois.find((p) => p.safe)
  if (!haven) throw new Error('no Haven')

  test('a horde walks a long way between two places, giving Haven and the lake a wide berth', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const plan = planMigration(def.pois, def.lakes, seeded(seed))
      if (!plan) throw new Error('no migration')
      const { from, to, route } = plan
      expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThanOrEqual(MIGRATION_MIN)
      expect(route[0]).toMatchObject({ x: from.x, z: from.z })
      expect(route.at(-1)).toMatchObject({ x: to.x, z: to.z })
      expect(nearestPass(route, haven)).toBeGreaterThan(haven.r + 150)
      for (const lake of def.lakes) expect(nearestPass(route, lake)).toBeGreaterThan(lake.r + 25)
      expect(from.safe || to.safe).toBeFalsy()
    }
  })

  test('a detour goes round, and along the route the crowd moves steadily', () => {
    const route = detour({ x: -500, z: 0 }, { x: 500, z: 10 }, [{ x: 0, z: 0, r: 200 }])
    expect(route.length).toBeGreaterThan(2)
    expect(nearestPass(route, { x: 0, z: 0 })).toBeGreaterThan(195)
    const len = routeLength(route)
    let last = alongRoute(route, 0)
    for (let m = 25; m <= len; m += 25) {
      const p = alongRoute(route, m)
      expect(Math.hypot(p.x - last.x, p.z - last.z)).toBeLessThanOrEqual(25.01)
      last = p
    }
    expect(alongRoute(route, len + 100)).toMatchObject({ x: 500, z: 10 })
  })
})

describe('footprints', () => {
  test('one of the dead on a trail is led on along it, the way it was walked', () => {
    const prints = new Footprints()
    // Somebody walks east from x = 0 to 40.
    for (let x = 0; x <= 40; x += 0.5) prints.step(1, x, 0, x / 2)
    const lead = prints.lead(1, 3, 21)
    if (!lead) throw new Error('no lead')
    // Not back to where it began: on, eastwards, about ten metres.
    expect(lead.x).toBeGreaterThan(9)
    expect(lead.x).toBeLessThan(14)
    // Following on, step by step, it gets to the trail's end.
    let at = { x: 1, z: 3 }
    for (let n = 0; n < 10; n++) {
      const next = prints.lead(at.x, at.z, 21)
      if (!next) break
      at = next
    }
    expect(at.x).toBeGreaterThan(38)
    // Too far from the trail: nothing to go on.
    expect(prints.lead(20, 12, 21)).toBeNull()
  })

  test('prints melt after PRINT_SECONDS, and a stride apart', () => {
    const prints = new Footprints()
    expect(prints.step(2, 0, 0, 0)).toBe(true)
    expect(prints.step(2, 0.5, 0, 0.2)).toBe(false)
    expect(prints.step(2, 2, 0, 0.5)).toBe(true)
    expect(prints.lead(0, 1, PRINT_SECONDS + 5)).toBeNull()
    prints.prune(PRINT_SECONDS + 5)
    expect(prints.prints).toHaveLength(0)
  })

  test('of two trails, it takes up the fresher', () => {
    const prints = new Footprints()
    for (let x = 0; x <= 20; x += 1.5) prints.step(1, x, 0, 10) // older, going east
    for (let x = 0; x <= 20; x += 1.5) prints.step(2, -x, 0.3, 60) // fresher, going west
    const lead = prints.lead(0, 1, 61)
    expect(lead?.trail).toBe(2)
    expect(lead?.x ?? 0).toBeLessThan(-5)
  })
})

/** A survival game with one player, and a way at the director's insides. */
function setup() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(11))
  const inbox: ServerMessage[] = []
  const id = game.join('P0', { send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }) ?? 0
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const director = (
    game.match as unknown as {
      survival: {
        weatherEffects: WeatherWorld
        slept: number
        pool: ServerPlayer[]
        zeds: Map<number, Zed>
        freeZombie(at: { x: number; y: number; z: number }): ServerPlayer | null
        place(z: ServerPlayer, kind: ZombieKind, home: number, hunter: boolean, at: unknown): void
      }
    }
  ).survival
  const player = () => {
    const p = game.players.get(id)
    if (!p) throw new Error('no player')
    return p
  }
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  const notices = () =>
    inbox.flatMap((m) => (m.type === ServerMsg.Notice ? [(m.notice as { text: string }).text] : []))
  return { game, def, director, player, run, notices }
}

describe('the weather in a running game', () => {
  test('a long storm floods the lake: the jetty goes under and the current takes you', () => {
    const t = setup()
    t.run(1)
    t.game.match.pinWeather('storm')
    // Ten minutes of storm go by (as if slept through).
    t.director.slept += 600
    t.run(1.1)
    const w = t.director.weatherEffects
    expect(w.flood).toBeGreaterThan(0.9)
    expect(t.notices().some((n) => n.includes('jetty is under water'))).toBe(false) // nobody near
    // Stand on the jetty (its deck over the calm water), and see where the water takes you.
    const lake = t.def.lakes[0]
    if (!lake) throw new Error('no lake')
    const drink = t.def.interactables.find((i) => i.key === 'lake_water')
    if (!drink) throw new Error('no jetty')
    const deck = lake.y + JETTY_ABOVE
    expect(lake.y + w.flood * FLOOD_RISE - deck).toBeGreaterThan(0.4)
    const p = t.player()
    const from = { x: drink.pos[0], y: deck, z: drink.pos[2] }
    p.state.pos = { ...from }
    t.run(1)
    expect(Math.hypot(p.state.pos.x - from.x, p.state.pos.z - from.z)).toBeGreaterThan(1)
  })

  test('the jetty comes back out once the storm has passed', () => {
    const t = setup()
    t.run(1)
    t.game.match.pinWeather('storm')
    t.director.slept += 600
    t.run(1.1)
    t.game.match.pinWeather('clear')
    t.director.slept += 1800
    t.run(1.1)
    expect(t.director.weatherEffects.flood).toBeLessThan(0.1)
  })

  test('in the snow the living leave a trail, and an idle walker follows it', () => {
    const t = setup()
    t.run(1)
    t.game.match.pinWeather('snow')
    t.director.slept += 900
    t.run(1.1)
    const w = t.director.weatherEffects
    expect(w.snow).toBeGreaterThan(0.8)
    // Out in the open woods, well away from any place.
    const x0 = -300
    const z0 = 40
    const p = t.player()
    for (let i = 0; i <= 30; i++) {
      const x = x0 + i
      p.state.pos = { x, y: heightAt(t.def.terrain, x, z0) + 0.05, z: z0 }
      p.state.grounded = true
      t.director.weatherEffects.step(i * 10)
      t.run(0.05)
    }
    expect(w.footprints.prints.length).toBeGreaterThan(10)
    // A walker standing about by where the trail began.
    const at = { x: x0 + 2, y: heightAt(t.def.terrain, x0 + 2, z0 + 3), z: z0 + 3 }
    const zombie = t.director.freeZombie(at)
    if (!zombie) throw new Error('no zombie')
    t.director.place(zombie, ZombieKind.Walker, -1, false, at)
    const zed = t.director.zeds.get(zombie.id)
    if (!zed) throw new Error('no zed')
    // The player well out of its sight, down the trail and beyond.
    p.state.pos = { x: x0 + 120, y: heightAt(t.def.terrain, x0 + 120, z0) + 0.05, z: z0 }
    w.second()
    expect(w.isTracking(zombie.id)).toBe(true)
    expect(zed.mood).toBe('investigate')
    expect(zed.lastKnown?.x ?? 0).toBeGreaterThan(x0 + 8)
  })

  test('heavy fog sets a horde walking: told on the radio, shown as a rumour', () => {
    const t = setup()
    t.run(1)
    t.game.match.pinWeather('fog')
    t.run(1.1)
    const w = t.director.weatherEffects
    expect(w.migration).not.toBeNull()
    expect(t.notices().some((n) => n.startsWith('The radio, through the static'))).toBe(true)
    const rumour = w.rumour()
    const head = w.head()
    if (!rumour || !head) throw new Error('no rumour')
    const off = Math.hypot(rumour.x - head.x, rumour.z - head.z)
    expect(off).toBeGreaterThan(20)
    expect(off).toBeLessThan(90)
    const info = t.game.match.info().survival
    expect(info?.horde?.to).toBe(rumour.to)
  })

  test('near the horde, real walkers come out and walk on along its way', () => {
    const t = setup()
    t.run(1)
    t.game.match.pinWeather('fog')
    t.run(1.1)
    const w = t.director.weatherEffects
    const m = w.migration
    const head = w.head()
    if (!m || !head) throw new Error('no migration')
    // Somebody 90 m off the crowd, to one side.
    const p = t.player()
    const x = head.x + Math.cos(head.heading + Math.PI / 2) * 90
    const z = head.z + Math.sin(head.heading + Math.PI / 2) * 90
    p.state.pos = { x, y: heightAt(t.def.terrain, x, z) + 1, z }
    t.run(1.1)
    expect(m.walkers.size).toBeGreaterThanOrEqual(6)
    expect(m.walkers.size).toBeLessThanOrEqual(15)
    for (const walker of m.walkers.values()) {
      expect(walker.zombie.state.alive).toBe(true)
      const zed = t.director.zeds.get(walker.zombie.id)
      expect(zed?.mood === 'investigate' || zed?.mood === 'chase').toBe(true)
    }
  })
})

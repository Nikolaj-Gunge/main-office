import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  createPhysicsWorld,
  DEFAULT_RULES,
  heightAt,
  initPhysics,
  loadMap,
  mergeRules,
  seeded,
  TICK_RATE,
  ZombieKind,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import { Zed } from './horde.ts'
import { Nav, navFor } from './pathing.ts'

/**
 * The dead finding their way: through towns, round walls and in through doors. The town chase
 * (`PATH_SECONDS=120 bun test apps/server/src/survival/pathing.test.ts` for the long version)
 * prints how long they spent stuck and how long thinking took.
 */
const SECONDS = Number(process.env.PATH_SECONDS ?? 30)

beforeAll(async () => {
  await initPhysics()
})

const realRandom = Math.random
afterEach(() => {
  Math.random = realRandom
})

interface Director {
  place(z: ServerPlayer, kind: ZombieKind, home: number, hunter: boolean, pos: Point): void
  pool: ServerPlayer[]
  zeds: Map<number, Zed>
}

function setup() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  const id = game.join('P0', { send: () => {} }) ?? 0
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const player = game.players.get(id)
  if (!player) throw new Error('no player')
  const director = (game.match as unknown as { survival: Director }).survival
  const put = (p: Point) => {
    player.state.pos = { ...p }
    player.state.vel = { x: 0, y: 0, z: 0 }
    player.protectedUntil = Number.POSITIVE_INFINITY
    player.health = 100
  }
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) {
      player.protectedUntil = Number.POSITIVE_INFINITY
      player.health = 100
      game.step()
      each?.()
    }
  }
  return { game, def, player, director, put, run }
}

const ground = (def: NonNullable<ReturnType<typeof loadMap>['survival']>, x: number, z: number) =>
  heightAt(def.terrain, x, z)

describe('pathing', () => {
  test(`30 of the dead chase someone round a town for ${SECONDS} s`, () => {
    const t = setup()
    Math.random = seeded(3)
    t.run(0.5)
    const town = t.def.pois.findIndex((p) => p.key === 'pinewatch')
    const poi = t.def.pois[town]
    if (!poi) throw new Error('no town')
    const rooms = t.def.rooms.filter(
      (r) =>
        Math.hypot((r.min[0] + r.max[0]) / 2 - poi.x, (r.min[1] + r.max[1]) / 2 - poi.z) < poi.r,
    )
    const hide = (i: number): Point => {
      const r = rooms[i % rooms.length]
      if (!r) throw new Error('no room')
      const x = (r.min[0] + r.max[0]) / 2
      const z = (r.min[1] + r.max[1]) / 2
      return { x, y: ground(t.def, x, z) + 0.2, z }
    }
    t.put(hide(0))
    // Everything out of the pool, then all 30 placed round the town, all hunting.
    for (const z of t.director.pool) t.game.retireZombie(z)
    const random = seeded(11)
    t.director.pool.forEach((z, i) => {
      const a = random() * Math.PI * 2
      const r = 25 + random() * 45
      const x = poi.x + Math.cos(a) * r
      const zz = poi.z + Math.sin(a) * r
      const kind = i % 5 === 0 ? ZombieKind.Runner : ZombieKind.Walker
      t.director.place(z, kind, town, true, { x, y: ground(t.def, x, zz), z: zz })
    })
    // Time the brains.
    const think = Zed.prototype.think
    let thinking = 0
    let thoughts = 0
    Zed.prototype.think = function (this: Zed, ...args: Parameters<Zed['think']>) {
      const t0 = performance.now()
      const out = think.apply(this, args)
      thinking += performance.now() - t0
      thoughts++
      return out
    }
    let stuck = 0
    let near = 0
    const last = new Map<number, { x: number; z: number }>()
    let ticks = 0
    let hop = 0
    try {
      t.run(SECONDS, () => {
        ticks++
        if (ticks % (15 * TICK_RATE) === 0) t.put(hide(++hop * 5))
        if (ticks % (TICK_RATE / 2) !== 0) return
        const me = t.player.state.pos
        for (const z of t.director.pool) {
          if (!z.state.alive) continue
          const p = z.state.pos
          const was = last.get(z.id)
          last.set(z.id, { x: p.x, z: p.z })
          const d = Math.hypot(p.x - me.x, p.z - me.z)
          if (d < 2.5) {
            near += 0.5
            continue
          }
          if (was && Math.hypot(p.x - was.x, p.z - was.z) < 0.25) stuck += 0.5
        }
      })
    } finally {
      Zed.prototype.think = think
    }
    const nav = navFor(t.game.world.map)
    if (nav) console.log('[pathing] nav', JSON.stringify(nav.stats))
    const alive = t.director.pool.filter((z) => z.state.alive).length
    const perTick = thinking / ticks
    console.log(
      `[pathing] ${SECONDS}s, ${alive} dead: stuck ${stuck.toFixed(1)} zombie-s ` +
        `(${((stuck / (alive * SECONDS)) * 100).toFixed(1)}%), at the target ${near.toFixed(1)} ` +
        `zombie-s, think ${perTick.toFixed(3)} ms/tick (${((thinking / thoughts) * 1000).toFixed(1)} µs each)`,
    )
    expect(alive).toBeGreaterThan(20)
    // Stuck (not moving, not at the target) well under a tenth of the time (12.6% before paths).
    expect(stuck / (alive * SECONDS)).toBeLessThan(0.08)
    // Pathfinding's share of a tick, on average (the budget is 0.3 ms with 30 of the dead).
    expect((nav?.stats.planMs ?? 0) / ticks).toBeLessThan(0.3)
  }, 600_000)
})

/** A room with one door, somewhere quiet. */
function cabin(t: ReturnType<typeof setup>) {
  const poi = t.def.pois.find((p) => p.key === 'cabin_1')
  if (!poi) throw new Error('no cabin')
  const room = t.def.rooms.find(
    (r) => Math.hypot((r.min[0] + r.max[0]) / 2 - poi.x, (r.min[1] + r.max[1]) / 2 - poi.z) < poi.r,
  )
  const door = room?.doors[0]
  if (!room || !door) throw new Error('no room')
  const x = (room.min[0] + room.max[0]) / 2
  const z = (room.min[1] + room.max[1]) / 2
  return { room, door, centre: { x, y: ground(t.def, x, z) + 0.2, z } }
}

describe('pathing: the way in', () => {
  test('one of the dead behind a house comes round and in through the door', () => {
    const t = setup()
    t.run(0.5)
    const { door, centre } = cabin(t)
    t.put(centre)
    // Behind the house: the far side from the door, 4 m out from the wall.
    const ax = centre.x - door[0]
    const az = centre.z - door[2]
    const l = Math.hypot(ax, az)
    const half = Math.max(Math.abs(ax), Math.abs(az))
    const bx = centre.x + (ax / l) * (half + 4)
    const bz = centre.z + (az / l) * (half + 4)
    for (const z of t.director.pool) t.game.retireZombie(z)
    const zombie = t.director.pool[0]
    if (!zombie) throw new Error('no zombie')
    t.director.place(zombie, ZombieKind.Walker, -1, true, {
      x: bx,
      y: ground(t.def, bx, bz),
      z: bz,
    })
    let stuckFor = 0
    let worst = 0
    let was = { ...zombie.state.pos }
    let reached = -1
    let ticks = 0
    t.run(40, () => {
      ticks++
      const p = zombie.state.pos
      if (reached < 0 && Math.hypot(p.x - centre.x, p.z - centre.z) < 2) reached = ticks / TICK_RATE
      if (ticks % (TICK_RATE / 2) !== 0 || reached >= 0) return
      stuckFor = Math.hypot(p.x - was.x, p.z - was.z) < 0.25 ? stuckFor + 0.5 : 0
      worst = Math.max(worst, stuckFor)
      was = { ...p }
    })
    expect(reached).toBeGreaterThan(0)
    expect(reached).toBeLessThan(40)
    expect(worst).toBeLessThan(5)
  })

  test('a path goes round a wall, never through it', () => {
    const t = setup()
    // A long wall out in the open woods, and a way from one side to the other.
    const x = -300
    const z = 600
    const y = ground(t.def, x, z)
    const wall = {
      center: [x, y + 1.5, z] as [number, number, number],
      size: [24, 3, 0.4] as [number, number, number],
      material: 'brick' as const,
    }
    const nav = new Nav([wall], t.def)
    const a = { x, y, z: z - 6 }
    const b = { x: x + 2, y, z: z + 6 }
    expect(nav.clear(a, b)).toBe(false)
    const path = nav.plan(a, b)
    if (!path) throw new Error('no path')
    expect(path.at(-1)).toEqual(b)
    let from: { x: number; z: number } = a
    for (const p of path) {
      expect(nav.clear(from, p)).toBe(true)
      from = p
    }
    // Round an end of the wall (12 m either side of the middle).
    expect(path.some((p) => Math.abs(p.x - x) > 12)).toBe(true)
  })
})

describe('the dead: what they are doing', () => {
  test('chase, lost (to where you were, sniffing about), then wander', () => {
    const t = setup()
    t.run(0.5)
    const x = -300
    const z = 600
    t.put({ x, y: ground(t.def, x, z) + 0.1, z })
    for (const zz of t.director.pool) t.game.retireZombie(zz)
    const zombie = t.director.pool[0]
    if (!zombie) throw new Error('no zombie')
    const zx = x + 8
    t.director.place(zombie, ZombieKind.Walker, -1, false, { x: zx, y: ground(t.def, zx, z), z })
    const zed = t.director.zeds.get(zombie.id) as Zed
    zed.mood = 'chase'
    zed.targetId = t.player.id
    zed.lastKnown = { ...t.player.state.pos }
    const chaseSpeed = zed.speedFactor
    // Gone, far off where it can't see or hear.
    const last = { ...t.player.state.pos }
    t.put({ x: x - 70, y: ground(t.def, x - 70, z + 40) + 0.1, z: z + 40 })
    t.player.state.crouched = true
    zed.lastKnown = last
    const moods: string[] = []
    let sniffing = 0
    t.run(30, () => {
      if (moods.at(-1) !== zed.mood) moods.push(zed.mood)
      const v = zombie.state.vel
      const p = zombie.state.pos
      if (
        zed.mood === 'lost' &&
        Math.hypot(v.x, v.z) < 0.2 &&
        Math.hypot(p.x - last.x, p.z - last.z) < 2.5
      )
        sniffing += 1 / TICK_RATE
    })
    expect(moods.slice(0, 3)).toEqual(
      ['chase', 'lost', 'wander'].slice(0, Math.min(3, moods.length)),
    )
    expect(moods).toContain('lost')
    expect(moods).toContain('wander')
    expect(sniffing).toBeGreaterThan(2)
    expect(chaseSpeed).toBeGreaterThan(0.6)
  })

  test('a noise: investigate, slower than a chase', () => {
    const t = setup()
    t.run(0.5)
    for (const zz of t.director.pool) t.game.retireZombie(zz)
    const zombie = t.director.pool[0]
    if (!zombie) throw new Error('no zombie')
    const x = -300
    const z = 600
    t.put({ x: x - 120, y: ground(t.def, x - 120, z) + 0.1, z })
    t.director.place(zombie, ZombieKind.Walker, -1, false, { x, y: ground(t.def, x, z), z })
    const zed = t.director.zeds.get(zombie.id) as Zed
    const wander = zed.speedFactor
    zed.alert({ x: x + 12, y: ground(t.def, x + 12, z), z }, t.game.tick / TICK_RATE)
    expect(zed.mood).toBe('investigate')
    expect(zed.speedFactor).toBeGreaterThan(wander)
    zed.mood = 'chase'
    const chase = zed.speedFactor
    zed.mood = 'investigate'
    expect(zed.speedFactor).toBeLessThan(chase)
    t.run(12)
    expect(Math.hypot(zombie.state.pos.x - (x + 12), zombie.state.pos.z - z)).toBeLessThan(3)
  })

  test('playing dead: lies still, twitches when you come close, then gets up', () => {
    const t = setup()
    t.run(0.5)
    for (const zz of t.director.pool) t.game.retireZombie(zz)
    const zombie = t.director.pool[0]
    if (!zombie) throw new Error('no zombie')
    const x = -300
    const z = 600
    t.put({ x: x + 9, y: ground(t.def, x + 9, z) + 0.1, z })
    t.player.state.crouched = true
    t.director.place(zombie, ZombieKind.Walker, -1, false, { x, y: ground(t.def, x, z), z })
    const zed = t.director.zeds.get(zombie.id) as Zed
    zed.mood = 'dead'
    t.run(1)
    expect(zombie.state.prone).toBe(true)
    // Somebody passing at 9 m: nothing.
    t.run(2)
    expect(zed.mood).toBe('dead')
    expect(zombie.state.prone).toBe(true)
    // Within 4 m: a twitch, still down…
    t.put({ x: x + 3, y: ground(t.def, x + 3, z) + 0.1, z })
    t.run(0.4)
    expect(zed.risingAt).toBeGreaterThan(0)
    expect(zombie.state.prone).toBe(true)
    // …then up and after you.
    t.run(2)
    expect(zed.mood as string).toBe('chase')
    expect(zombie.state.prone).toBe(false)
  })

  test('a crawler gets up only as far as crawling after you', () => {
    const t = setup()
    t.run(0.5)
    for (const zz of t.director.pool) t.game.retireZombie(zz)
    const zombie = t.director.pool[0]
    if (!zombie) throw new Error('no zombie')
    const x = -300
    const z = 600
    t.put({ x: x + 3, y: ground(t.def, x + 3, z) + 0.1, z })
    t.director.place(zombie, ZombieKind.Walker, -1, false, { x, y: ground(t.def, x, z), z })
    const zed = t.director.zeds.get(zombie.id) as Zed
    zed.mood = 'dead'
    zed.crawler = true
    t.put({ x: x + 6, y: ground(t.def, x + 6, z) + 0.1, z })
    t.run(1)
    t.put({ x: x + 3, y: ground(t.def, x + 3, z) + 0.1, z })
    t.run(3)
    expect(zed.mood as string).toBe('chase')
    expect(zombie.state.prone).toBe(true)
  })
})

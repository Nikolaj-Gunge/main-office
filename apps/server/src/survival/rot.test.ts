import { beforeAll, describe, expect, test } from 'bun:test'
import {
  BIRDS_NEAR,
  BIRDS_SHOT,
  createPhysicsWorld,
  crunchAt,
  DEFAULT_RULES,
  decodeServerMessage,
  encodeServerMessage,
  flocksOf,
  heightAt,
  initPhysics,
  loadMap,
  MOODS,
  mergeRules,
  moodFor,
  ROT_MOODS,
  RotPhase,
  type ServerMessage,
  ServerMsg,
  type SurvivalDef,
  seeded,
  TICK_RATE,
  WeaponId,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import { Zed } from './horde.ts'
import {
  AMBUSH_MAX,
  AMBUSH_MIN,
  ambushSpot,
  PEAK_HOLD,
  RELAX_MIN,
  Rot,
  type RotSense,
  UNSEEN_ANGLE,
  unseen,
} from './rot.ts'
import { type RotHost, RotWorld } from './rot-world.ts'

beforeAll(async () => {
  await initPhysics()
})

const def = loadMap('deadwood').survival as SurvivalDef

const calm = (id = 1, more: Partial<RotSense> = {}): RotSense => ({
  id,
  health: 1,
  ammo: 1,
  dark: 0,
  infection: 0,
  chasers: 0,
  safe: false,
  ...more,
})

describe('the Rot: tension and phases', () => {
  test('build-up → peak (held a few seconds) → relax → build-up again', () => {
    const rot = new Rot(seeded(1))
    let t = 0
    rot.update(t, [calm()])
    expect(rot.phase(1)).toBe(RotPhase.Build)
    expect(rot.tension(1)).toBeLessThan(0.05)
    // Bitten hard twice and chased: it peaks.
    rot.hurt(1, 20)
    rot.hurt(1, 20)
    rot.update(++t, [calm(1, { chasers: 3, health: 0.4 })])
    expect(rot.phase(1)).toBe(RotPhase.Peak)
    // The peak holds for a few seconds, however bad it stays.
    for (let i = 1; i < PEAK_HOLD; i++) {
      rot.update(++t, [calm(1, { chasers: 3 })])
      expect(rot.phase(1)).toBe(RotPhase.Peak)
    }
    rot.update(++t, [calm(1, { chasers: 3 })])
    expect(rot.phase(1)).toBe(RotPhase.Relax)
    // Relaxing lasts at least RELAX_MIN, and then only once things have calmed down.
    const relaxed = t
    while (t < relaxed + RELAX_MIN - 1) {
      rot.update(++t, [calm()])
      expect(rot.phase(1)).toBe(RotPhase.Relax)
    }
    for (let i = 0; i < 60 && rot.phase(1) === RotPhase.Relax; i++) rot.update(++t, [calm()])
    expect(rot.phase(1)).toBe(RotPhase.Build)
    expect(rot.tension(1)).toBeLessThan(0.35)
  })

  test('the dark, low health and ammo and the bite raise it, but never to a peak alone', () => {
    const rot = new Rot(seeded(2))
    rot.update(0, [calm(1, { dark: 1, health: 0.1, ammo: 0, infection: 4 })])
    expect(rot.tension(1)).toBeGreaterThan(0.3)
    expect(rot.tension(1)).toBeLessThan(0.5)
    expect(rot.phase(1)).toBe(RotPhase.Build)
  })

  test('events come now and then while it builds; never while relaxing or in Haven', () => {
    const rot = new Rot(seeded(3))
    let events = 0
    for (let t = 0; t < 1200; t++) events += rot.update(t, [calm(1, { dark: 1 })]).length
    // Every 70–130 s at night.
    expect(events).toBeGreaterThanOrEqual(7)
    expect(events).toBeLessThanOrEqual(17)
    const safe = new Rot(seeded(3))
    let none = 0
    for (let t = 0; t < 1200; t++) none += safe.update(t, [calm(1, { safe: true })]).length
    expect(none).toBe(0)
    const relaxing = new Rot(seeded(3))
    relaxing.hurt(1, 100)
    relaxing.update(0, [calm(1, { chasers: 3 })])
    let during = 0
    for (let t = 1; t < 40; t++) {
      during += relaxing.update(t, [calm(1, { dark: 1 })]).length
    }
    expect(during).toBe(0)
  })

  test('the client is told its tension as a byte, when it changes or it was just spotted', () => {
    const rot = new Rot(seeded(4))
    rot.update(0, [calm()])
    expect(rot.message(1)).not.toBeNull()
    expect(rot.message(1)).toBeNull()
    rot.spotted(1)
    expect(rot.message(1)?.spotted).toBe(true)
    const msg: ServerMessage = { type: ServerMsg.Tension, level: 0.5, phase: 1, spotted: true }
    const back = decodeServerMessage(encodeServerMessage(msg))
    expect(back.type).toBe(ServerMsg.Tension)
    if (back.type !== ServerMsg.Tension) return
    expect(back.level).toBeCloseTo(0.5, 2)
    expect(back.phase).toBe(1)
    expect(back.spotted).toBe(true)
  })

  test('every night has a mood, the same for the same world, and all of them come up', () => {
    expect(moodFor(42, 3)).toBe(moodFor(42, 3))
    const seen = new Set(Array.from({ length: 60 }, (_, n) => moodFor(9, n)))
    for (const m of ROT_MOODS) {
      expect(seen.has(m)).toBe(true)
      expect(MOODS[m].news.length).toBeGreaterThan(20)
    }
  })
})

describe('the Rot: out of sight', () => {
  const open = () => true
  const me = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, vel: { x: 0, z: -5 } }

  test('in front of you is seen; well round to the side, or behind a wall, is not', () => {
    expect(unseen(me, { x: 0, y: 0, z: -50 }, open)).toBe(false)
    const side = ((UNSEEN_ANGLE + 5) * Math.PI) / 180
    expect(unseen(me, { x: -Math.sin(side) * 50, y: 0, z: -Math.cos(side) * 50 }, open)).toBe(
      true,
    )
    expect(unseen(me, { x: 0, y: 0, z: -50 }, () => false)).toBe(true)
  })

  test('an ambush is ahead of where you go, 40–65 m off and out of everybody’s sight', () => {
    // Somewhere in the woods, walking north (−z) while looking east.
    const x = -300
    const z = 600
    const who = {
      pos: { x, y: heightAt(def.terrain, x, z), z },
      yaw: -Math.PI / 2,
      vel: { x: 0, z: -4 },
    }
    const random = seeded(5)
    let found = 0
    for (let n = 0; n < 40; n++) {
      const at = ambushSpot(def, who, [who], open, random)
      if (!at) continue
      found++
      const d = Math.hypot(at.x - x, at.z - z)
      expect(d).toBeGreaterThanOrEqual(AMBUSH_MIN - 0.01)
      expect(d).toBeLessThanOrEqual(AMBUSH_MAX + 0.01)
      // Ahead: north of you.
      expect(at.z).toBeLessThan(z)
      expect(unseen(who, at, open)).toBe(true)
      expect(at.y).toBeCloseTo(heightAt(def.terrain, at.x, at.z), 3)
    }
    expect(found).toBeGreaterThan(20)
    // Looking straight where you go, in the open: nowhere will do.
    const looking = { ...who, yaw: 0 }
    expect(ambushSpot(def, looking, [looking], open, seeded(6))).toBeNull()
    // Unless the trees hide it.
    expect(ambushSpot(def, looking, [looking], () => false, seeded(6))).not.toBeNull()
  })
})

/** A RotWorld on a fake world: people and the dead stand where the test puts them. */
function world() {
  const sent: { to: number; msg: ServerMessage }[] = []
  const people: { player: ServerPlayer; self: never; safe: boolean }[] = []
  const zombies: { player: ServerPlayer; zed: Zed }[] = []
  const spawned: Point[] = []
  let now = 0
  const body = (id: number, pos: Point) =>
    ({
      id,
      health: 100,
      maxHealth: 100,
      state: {
        pos: { ...pos },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
        weapon: { id: WeaponId.Handgun, ammo: 12, reserve: 24 },
      },
    }) as unknown as ServerPlayer
  const host: RotHost = {
    def: () => def,
    random: seeded(11),
    now: () => now,
    light: () => 0,
    people: () => people,
    zombies: () => zombies,
    clear: () => false,
    spawn: (at) => {
      spawned.push(at)
      return true
    },
    parked: () => [],
    send: (player, msg) => sent.push({ to: player.id, msg }),
    notice: () => {},
    broadcast: () => {},
  }
  const rot = new RotWorld(host)
  rot.reset()
  return {
    rot,
    sent,
    spawned,
    addPerson: (id: number, pos: Point) => {
      const player = body(id, pos)
      people.push({ player, self: { infected: null } as never, safe: false })
      return player
    },
    addZed: (id: number, pos: Point) => {
      const zed = new Zed(seeded(id))
      const player = body(id, pos)
      zombies.push({ player, zed })
      return zed
    },
    at: (t: number) => {
      now = t
    },
  }
}

describe('the Rot: birds', () => {
  const flocks = flocksOf(def)
  const flock = flocks[Math.floor(flocks.length / 2)]
  if (!flock) throw new Error('no birds')
  const ground = (x: number, z: number) => ({ x, y: heightAt(def.terrain, x, z), z })

  test('there are flocks about the woods and fields, away from places', () => {
    expect(flocks.length).toBeGreaterThan(60)
    for (const f of flocks)
      for (const p of def.pois) expect(Math.hypot(f.x - p.x, f.z - p.z)).toBeGreaterThan(p.r)
  })

  test('a person walking close sends them up; the dead never do', () => {
    const w = world()
    const i = flocks.indexOf(flock)
    w.addZed(500, ground(flock.x + 2, flock.z))
    w.rot.step()
    expect(w.rot.isAway(i)).toBe(false)
    w.addPerson(1, ground(flock.x + BIRDS_NEAR + 3, flock.z))
    w.rot.step()
    expect(w.rot.isAway(i)).toBe(false)
    const far = w.addPerson(2, ground(flock.x + 300, flock.z))
    const near = w.addPerson(3, ground(flock.x + BIRDS_NEAR - 2, flock.z))
    w.rot.step()
    expect(w.rot.isAway(i)).toBe(true)
    // Heard from far away, with where it happened; and the dead nearby come to look.
    const heard = w.sent.filter(
      (s) => s.msg.type === ServerMsg.Notice && s.msg.notice.sound === 'birds',
    )
    expect(heard.map((s) => s.to).sort()).toEqual([1, far.id, near.id])
    expect(w.rot.shared().birds).toContain(i)
  })

  test('a gunshot within 60 m sends them up; they settle again later', () => {
    const w = world()
    const i = flocks.indexOf(flock)
    const shooter = w.addPerson(1, ground(flock.x + BIRDS_SHOT + 10, flock.z))
    w.rot.shot(shooter)
    expect(w.rot.isAway(i)).toBe(false)
    shooter.state.pos = ground(flock.x + BIRDS_SHOT - 10, flock.z)
    w.rot.shot(shooter)
    expect(w.rot.isAway(i)).toBe(true)
    shooter.state.pos = ground(flock.x + 500, flock.z)
    w.at(10_000)
    w.rot.step()
    expect(w.rot.isAway(i)).toBe(false)
  })

  test('the dead after somebody relaxing give up when out of sight', () => {
    const w = world()
    const me = w.addPerson(1, ground(-300, 600))
    const zed = w.addZed(500, ground(-300, 640))
    zed.mood = 'chase'
    zed.targetId = me.id
    w.rot.director.hurt(me.id, 200)
    for (let t = 1; t < 4; t++) {
      w.at(t)
      w.rot.tick()
    }
    // Peak first: it keeps coming.
    expect(w.rot.director.phase(me.id)).toBe(RotPhase.Peak)
    expect(zed.mood).toBe('chase')
    for (let t = 4; t < 12; t++) {
      w.at(t)
      zed.mood = 'chase'
      zed.targetId = me.id
      w.rot.tick()
    }
    expect(w.rot.relaxing(me)).toBe(true)
    expect(zed.mood).toBe('search')
  })
})

describe('the Rot in a game', () => {
  test('somebody relaxing gets no new roaming dead around them', () => {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(7))
    const id = game.join('P0', { send: () => {} }) ?? 0
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    const director = game.match.survivalDirector
    if (!director) throw new Error('no director')
    const p = game.players.get(id)
    if (!p) throw new Error('no player')
    const run = (s: number) => {
      for (let i = 0; i < s * TICK_RATE; i++) game.step()
    }
    run(1)
    p.state.pos = { x: -300, y: heightAt(def.terrain, -300, 600) + 0.1, z: 600 }
    p.protectedUntil = Number.POSITIVE_INFINITY
    // Peak, then relax.
    director.rotWorld.director.hurt(id, 200)
    run(PEAK_HOLD + 2)
    expect(director.rotWorld.relaxing(p)).toBe(true)
    for (const z of game.players.values()) if (z.zombie && z.state.alive) game.retireZombie(z)
    run(8)
    const near = [...game.players.values()].filter(
      (z) =>
        z.zombie &&
        z.state.alive &&
        // (A camper's dead nearby stay: only the roaming ones are held back.)
        (z.zombie as Zed).home === -1 &&
        Math.hypot(z.state.pos.x - p.state.pos.x, z.state.pos.z - p.state.pos.z) < 150,
    )
    expect(near.length).toBe(0)
  })

  test('glass and branches underfoot make your steps carry', () => {
    const map = loadMap('deadwood')
    const game = new Game(map, createPhysicsWorld(map), seeded(7))
    const id = game.join('P0', { send: () => {} }) ?? 0
    game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
    const director = game.match.survivalDirector
    const p = game.players.get(id)
    if (!director || !p) throw new Error('no game')
    let spot: { x: number; z: number } | null = null
    for (let x = -600; x < 600 && !spot; x += 0.5)
      for (let z = 500; z < 700 && !spot; z += 7)
        if (crunchAt(def, x, z) === 'branch') spot = { x, z }
    if (!spot) throw new Error('no branches')
    const walk = (x: number, z: number) => {
      p.state.pos = { x, y: heightAt(def.terrain, x, z), z }
      p.state.vel = { x: 3, y: 0, z: 0 }
      p.state.grounded = true
      return director.heardFrom(p)
    }
    const crunchy = walk(spot.x, spot.z)
    const quiet = walk(spot.x + 3.5, spot.z + 3.5)
    expect(crunchAt(def, spot.x + 3.5, spot.z + 3.5)).toBeNull()
    expect(crunchy).toBeGreaterThan(quiet * 2)
  })
})

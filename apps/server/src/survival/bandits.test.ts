import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  createPlayerState,
  createWeaponState,
  DAY_SECONDS,
  DEFAULT_RULES,
  HEAD_LOOKS,
  headLook,
  ITEMS,
  initPhysics,
  loadMap,
  MAX_PLAYERS,
  mergeRules,
  seeded,
  TICK_RATE,
  WeaponId,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import { MemoryStore } from '../saves.ts'
import { aimError, BanditBrain, type BanditView, sightRange, type Threat } from './bandit-brain.ts'
import { BANDIT_SLOTS, CAMP_RESPAWN_DAYS, CAMP_WAKE, RAID_ROAD } from './bandits.ts'
import type { SurvivalDirector } from './director.ts'
import type { Zed } from './horde.ts'
import { SHIELD_RADIUS } from './newcomer.ts'

beforeAll(async () => {
  await initPhysics()
})

const def = () => {
  const d = loadMap('deadwood').survival
  if (!d) throw new Error('no survival map')
  return d
}

const threat = (o: Partial<Threat> = {}): Threat => ({
  id: 7,
  pos: { x: 0, y: 0, z: -20 },
  zombie: false,
  lit: false,
  crouched: false,
  hidden: 0,
  ...o,
})

function view(o: Partial<BanditView> = {}): BanditView {
  return {
    now: 0,
    dt: 1 / TICK_RATE,
    light: 1,
    threats: [],
    clear: () => true,
    cover: () => null,
    goal: null,
    leash: null,
    ...o,
  }
}

describe('bandit senses and aim', () => {
  test('they see far by day, close by night, and a torch gives you away', () => {
    const t = threat()
    expect(sightRange(1, t)).toBeGreaterThan(sightRange(0, t) * 2)
    expect(sightRange(0, threat({ lit: true }))).toBeGreaterThan(sightRange(0, t) * 2)
    expect(sightRange(1, threat({ crouched: true }))).toBeLessThan(sightRange(1, t))
    expect(sightRange(1, threat({ hidden: 0.25 }))).toBeLessThan(sightRange(1, t))
    // The dead only matter close up.
    expect(sightRange(1, threat({ zombie: true }))).toBeLessThanOrEqual(25)
  })

  test('their aim gets worse with distance and darkness, and settles while tracking', () => {
    expect(aimError(40, 1, false)).toBeGreaterThan(aimError(10, 1, false))
    expect(aimError(20, 0, false)).toBeGreaterThan(aimError(20, 1, false) * 1.5)
    // Lit up at night: easier to hit.
    expect(aimError(20, 0, true)).toBeLessThan(aimError(20, 0, false))
    expect(aimError(20, 1, false, 0)).toBeGreaterThan(aimError(20, 1, false, 3))
    // About a metre off at 30 m by day: a fair chance to hit, no sure thing.
    const off = Math.tan(aimError(30, 1, false)) * 30
    expect(off).toBeGreaterThan(0.6)
    expect(off).toBeLessThan(3)
  })
})

describe('bandit brain', () => {
  const self = () => {
    const s = createPlayerState(
      { pos: [0, 0, 0], yaw: 0 },
      createWeaponState(WeaponId.Sks),
      null,
      null,
    )
    return s
  }

  test('with nothing going on it walks to its post, then stands there', () => {
    const brain = new BanditBrain(seeded(1))
    const s = self()
    const walk = brain.think(s, view({ goal: { x: 0, y: 0, z: -10 } }))
    expect(walk.buttons & Button.Forward).toBeTruthy()
    expect(brain.mood).toBe('idle')
    const stay = brain.think(s, view({ goal: { x: 0, y: 0, z: 0.5 } }))
    expect(stay.buttons & (Button.Forward | Button.Back)).toBe(0)
  })

  test('seeing somebody starts a fight (and a shout); a wall in between does not', () => {
    const hidden = new BanditBrain(seeded(2))
    hidden.think(self(), view({ threats: [threat()], clear: () => false }))
    expect(hidden.mood).toBe('idle')
    expect(hidden.spotted).toBeNull()

    const brain = new BanditBrain(seeded(2))
    brain.think(self(), view({ threats: [threat()] }))
    expect(brain.mood).toBe('fight')
    expect(brain.targetId).toBe(7)
    expect(brain.spotted?.id).toBe(7)
    // Too far in the dark: not seen.
    const night = new BanditBrain(seeded(2))
    night.think(self(), view({ light: 0, threats: [threat({ pos: { x: 0, y: 0, z: -40 } })] }))
    expect(night.mood).toBe('idle')
  })

  test('in a fight it ducks into cover, then steps out and shoots', () => {
    const brain = new BanditBrain(seeded(3))
    const s = self()
    const t = threat()
    let fired = 0
    let crouched = 0
    for (let i = 0; i < 6 * TICK_RATE; i++) {
      const c = brain.think(s, view({ now: i / TICK_RATE, threats: [t] }))
      if (c.buttons & Button.Fire) {
        fired++
        // Pretend the gun went off.
        s.weapon.ammo = Math.max(0, s.weapon.ammo - 1)
      }
      if (c.buttons & Button.Crouch) crouched++
    }
    expect(fired).toBeGreaterThan(1)
    expect(crouched).toBeGreaterThan(10)
  })

  test('it loses you after a while and goes to look where you were', () => {
    const brain = new BanditBrain(seeded(4))
    const s = self()
    brain.think(s, view({ threats: [threat()] }))
    expect(brain.mood).toBe('fight')
    let now = 0
    for (let i = 0; i < 8 * TICK_RATE; i++) {
      now = i / TICK_RATE
      brain.think(s, view({ now, threats: [threat()], clear: () => false }))
    }
    expect(brain.mood).toBe('alert')
  })

  test('one of the dead too close: it backs away while shooting', () => {
    const brain = new BanditBrain(seeded(5))
    const s = self()
    const z = threat({ zombie: true, pos: { x: 0, y: 0, z: -3 } })
    let back = 0
    for (let i = 0; i < 30; i++) {
      const c = brain.think(s, view({ now: i / TICK_RATE, threats: [z] }))
      if (c.buttons & Button.Back) back++
    }
    expect(brain.mood).toBe('fight')
    expect(back).toBeGreaterThan(10)
  })

  test('a gunshot makes it go and look', () => {
    const brain = new BanditBrain(seeded(6))
    brain.hear({ x: 0, y: 0, z: -30 }, 0)
    expect(brain.mood).toBe('alert')
    const c = brain.think(self(), view({ now: 0.1 }))
    expect(c.buttons & Button.Forward).toBeTruthy()
  })
})

describe('bandit camps in the world', () => {
  test('two or three camps, deep in the woods, nowhere near Haven or the newcomer woods', () => {
    const d = def()
    const camps = d.pois.filter((p) => p.kind === 'bandits')
    expect(camps.length).toBeGreaterThanOrEqual(2)
    expect(camps.length).toBeLessThanOrEqual(3)
    const haven = d.pois.find((p) => p.key === 'haven')
    const cabin = d.pois.find((p) => p.kind === 'start')
    if (!haven || !cabin) throw new Error('missing')
    for (const c of camps) {
      expect(Math.hypot(c.x - haven.x, c.z - haven.z)).toBeGreaterThan(CAMP_WAKE + haven.r + 100)
      expect(Math.hypot(c.x - cabin.x, c.z - cabin.z)).toBeGreaterThan(CAMP_WAKE + SHIELD_RADIUS)
      // Not on top of any other place.
      for (const p of d.pois) {
        if (p === c) continue
        expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeGreaterThan(c.r + p.r + 10)
      }
      // A loot crate.
      expect(d.loot.some((l) => Math.hypot(l.pos[0] - c.x, l.pos[2] - c.z) < c.r)).toBe(true)
      // Nobody dead lives there (the people do).
      expect(d.zombieSpots.some((s) => Math.hypot(s.pos[0] - c.x, s.pos[2] - c.z) < c.r)).toBe(
        false,
      )
    }
  })

  test("the raiders' road ends outside Haven's fence", () => {
    const d = def()
    const haven = d.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    const gate = RAID_ROAD[RAID_ROAD.length - 1] as Point
    expect(Math.hypot(gate.x - haven.x, gate.z - haven.z)).toBeGreaterThan(haven.r)
  })
})

interface Insides {
  rare: Map<string, number>
  slept: number
  loot: Map<number, { item: string; x: number; z: number }>
  zeds: Map<number, Zed>
  pool: ServerPlayer[]
  prey(alive: unknown[]): { id: number }[]
}

async function server() {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(21))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(new MemoryStore())
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const join = (name: string): ServerPlayer => {
    const id = game.join(name, { send: () => {} })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    p.protectedUntil = Number.POSITIVE_INFINITY
    return p
  }
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
      each?.()
      game.step()
    }
  }
  const bandits = () => [...game.players.values()].filter((p) => p.npc)
  const camp = def().pois.find((p) => p.kind === 'bandits')
  if (!camp) throw new Error('no camp')
  return { game, director, insides, join, run, bandits, camp }
}

describe('bandits in a running game', () => {
  test('a camp wakes when somebody comes near: armed, masked, not survivors', async () => {
    const { game, director, join, run, bandits, camp } = await server()
    const p = join('Ann')
    expect(bandits().length).toBe(0)
    p.state.pos = { x: camp.x + 120, y: camp.y + 1, z: camp.z }
    run(1.1)
    const out = bandits()
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.length).toBeLessThanOrEqual(BANDIT_SLOTS)
    expect(game.players.size).toBeLessThanOrEqual(MAX_PLAYERS)
    for (const b of out) {
      expect(b.state.alive).toBe(true)
      expect(b.appearance).toBeDefined()
      expect(b.state.weapon.ammo).toBeGreaterThan(0)
      const head = headLook(director.gearOf(b))
      expect([HEAD_LOOKS.bandana, HEAD_LOOKS.gasmask] as number[]).toContain(head)
      // Only sent close up (the AOI keeps them near-only, like the dead).
      expect(Math.hypot(b.state.pos.x - camp.x, b.state.pos.z - camp.z)).toBeLessThan(camp.r)
    }
    // Everybody leaves: so do they (their places go back to the dead).
    p.state.pos = { x: camp.x + 600, y: camp.y + 1, z: camp.z }
    run(28)
    expect(bandits().length).toBe(0)
  })

  test('they shoot somebody standing in the open, for real', async () => {
    const { director, join, run, bandits, camp } = await server()
    director.setTime(0.6)
    const p = join('Bo')
    p.state.pos = { x: camp.x + 10, y: camp.y + 0.2, z: camp.z + 1 }
    run(1.1, () => {
      p.state.pos = { x: camp.x + 10, y: camp.y + 0.2, z: camp.z + 1 }
    })
    expect(bandits().length).toBeGreaterThan(0)
    p.protectedUntil = 0
    let hurt = false
    run(12, () => {
      if (p.state.alive) p.state.pos = { x: camp.x + 10, y: camp.y + 0.2, z: camp.z + 1 }
      if (p.health < p.maxHealth || !p.state.alive) hurt = true
    })
    expect(hurt).toBe(true)
  })

  test('a dead bandit drops its gun, ammo and maybe food; the camp fills up days later', async () => {
    const { game, director, insides, join, run, bandits, camp } = await server()
    const p = join('Cy')
    p.state.pos = { x: camp.x + 120, y: camp.y + 1, z: camp.z }
    run(1.1)
    const info = () => director.bandits.campsInfo().find((c) => c.key === camp.key)
    const size = info()?.left ?? 0
    expect(size).toBeGreaterThanOrEqual(3)
    const first = bandits()[0] as ServerPlayer
    const at = { ...first.state.pos }
    const gun = first.state.weapon.id
    game.killPlayer(first.id, p.id)
    const near = [...insides.loot.values()].filter((l) => Math.hypot(l.x - at.x, l.z - at.z) < 3)
    expect(near.some((l) => ITEMS[l.item]?.weapon === gun)).toBe(true)
    expect(near.some((l) => ITEMS[l.item]?.kind === 'ammo')).toBe(true)
    expect(info()?.left).toBe(size - 1)

    for (const b of bandits()) if (b.state.alive) game.killPlayer(b.id, p.id)
    expect(info()?.left).toBe(0)
    // Nobody comes back the same day…
    director.bandits.tick()
    expect(info()?.left).toBe(0)
    // …but a day and a half later, they're back.
    insides.slept += CAMP_RESPAWN_DAYS * DAY_SECONDS + 10
    director.bandits.tick()
    expect(info()?.left).toBe(size)
  })

  test('their gunfire brings the dead, and the dead hunt them too', async () => {
    const { game, insides, director, join, run, bandits, camp } = await server()
    const p = join('Di')
    p.state.pos = { x: camp.x + 120, y: camp.y + 1, z: camp.z }
    run(1.1)
    const b = bandits()[0] as ServerPlayer
    // Bandits are prey.
    const prey = insides.prey([])
    expect(prey.some((x) => x.id === b.id)).toBe(true)
    // One of the dead 40 m off hears a bandit's shot.
    const z = insides.pool.find((x) => !x.state.alive) as ServerPlayer
    z.state.alive = true
    z.state.pos = { x: b.state.pos.x + 40, y: b.state.pos.y, z: b.state.pos.z }
    const zed = insides.zeds.get(z.id) as Zed
    zed.mood = 'idle'
    director.bandits.onShot(b)
    expect(zed.mood as string).toBe('investigate')
    // And claws hurt bandits (different teams).
    expect(game.match.canHurt(z, b)).toBe(true)
  })

  test('raiders come up the road, rob the stores if they reach the gate, and leave', async () => {
    const { insides, director, join, run, bandits } = await server()
    const p = join('Ed')
    p.state.pos = { x: 0, y: 2, z: 480 }
    insides.rare.set('nvg', 1)
    expect(director.bandits.startRaid()).toBe(true)
    const raiders = bandits()
    const lead = raiders[0] as ServerPlayer
    expect(raiders.length).toBeGreaterThanOrEqual(3)
    expect(raiders.every((r) => r.name === 'Raider')).toBe(true)
    expect(director.bandits.startRaid()).toBe(false)
    // They walk towards Haven.
    const start = Math.hypot(lead.state.pos.x, lead.state.pos.z - 480)
    run(4)
    const later = Math.hypot(lead.state.pos.x, lead.state.pos.z - 480)
    expect(later).toBeLessThan(start)
    // One gets to the gate: the stores are robbed.
    const gate = RAID_ROAD[RAID_ROAD.length - 1] as Point
    lead.state.pos = { x: gate.x, y: lead.state.pos.y, z: gate.z }
    director.bandits.tick()
    expect(director.bandits.raiding?.stole).toBe(true)
    expect(insides.rare.size).toBe(0)
  })

  test('a raid beaten off leaves the stores alone', async () => {
    const { game, insides, director, join, bandits } = await server()
    const p = join('Flo')
    p.state.pos = { x: 0, y: 2, z: 480 }
    insides.rare.set('nvg', 1)
    director.bandits.startRaid()
    for (const r of bandits()) game.killPlayer(r.id, p.id)
    director.bandits.tick()
    expect(director.bandits.raiding).toBeNull()
    expect(insides.rare.get('nvg')).toBe(1)
  })
})

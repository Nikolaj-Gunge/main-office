import { beforeAll, describe, expect, test } from 'bun:test'
import {
  ammoBeside,
  BAREFOOT_NOISE,
  Button,
  carried,
  countOf,
  createPhysicsWorld,
  DEFAULT_RULES,
  DROP_LAND,
  decodeServerMessage,
  FEET_LOOKS,
  feetLook,
  GEAR,
  gearLooks,
  give,
  gridOf,
  HAVEN_FIRE,
  HAVEN_SEATS,
  heightAt,
  INFECTION_SECONDS,
  ITEMS,
  initPhysics,
  LEGS_LOOKS,
  LOOT_TABLES,
  legsLook,
  loadMap,
  MAX_PLANKS,
  MAX_PLAYERS,
  type MatchInfo,
  mergeRules,
  PLANK_HP,
  planksFor,
  QUESTS,
  RARE_STOCK,
  rollLoot,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  sizeOf,
  spotCentre,
  TICK_RATE,
  TRADER_STOCK,
  tableItems,
  WEAPONS,
  WeaponId,
  type WeatherKind,
  weatherAt,
  ZombieKind,
} from '@office-fps/shared'
import { CLAW_TIMING } from '../claw-attack.ts'
import { Game, type ServerPlayer } from '../game.ts'
import { START_MONEY } from './director.ts'
import { openGround } from './drops.ts'
import { POOL, type Zed } from './horde.ts'

beforeAll(async () => {
  await initPhysics()
})

/** What's carried, without where it lies. */
const plain = (inv: readonly { item: string; n: number }[]) =>
  inv.map(({ item, n }) => ({ item, n }))

/** Where the first stack of an item lies (to point an action at it). */
function cellOf(self: SurvivalSelf, item: string) {
  const s = self.inv.find((st) => st.item === item)
  if (!s) throw new Error(`no ${item}`)
  return { c: s.c, x: s.x, y: s.y }
}

function setup(n = 1) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(7))
  const clients = Array.from({ length: n }, () => {
    const inbox: ServerMessage[] = []
    return { inbox, send: (b: Uint8Array) => inbox.push(decodeServerMessage(b)) }
  })
  const ids = clients.map((c, i) => game.join(`P${i}`, c) ?? 0)
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  const def = map.survival
  if (!def) throw new Error('no survival world')
  const player = (i = 0) => {
    const p = game.players.get(ids[i] ?? 0)
    if (!p) throw new Error('no player')
    return p
  }
  const last = <T extends ServerMessage['type']>(type: T, i = 0) =>
    clients[i]?.inbox
      .filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
      .at(-1)
  const self = (i = 0): SurvivalSelf => {
    const m = last(ServerMsg.Survival, i)
    if (!m) throw new Error('no survival state')
    return m.self
  }
  const match = (): MatchInfo => {
    game.match.broadcast()
    const m = last(ServerMsg.Match)
    if (!m) throw new Error('no match')
    return m.match
  }
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) game.step()
  }
  let seq = 1
  /** One tick of input for player 0 (looking along yaw/pitch). */
  const input = (buttons: number, yaw = 0, pitch = 0) => {
    game.handleInput(ids[0] ?? 0, [{ seq: seq++, buttons, yaw, pitch, viewTick: game.tick }])
    game.step()
  }
  /** Puts player 0 at a spot (feet) and keeps them out of harm's way. */
  const move = (x: number, y: number, z: number) => {
    const p = player()
    p.state.pos = { x, y, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
    p.protectedUntil = Number.POSITIVE_INFINITY
  }
  /** Looks at a point from where player 0 stands and presses E. */
  const useAt = (x: number, y: number, z: number) => {
    const s = player().state
    const dx = x - s.pos.x
    const dy = y - (s.pos.y + 1.6)
    const dz = z - s.pos.z
    const yaw = Math.atan2(-dx, -dz)
    const pitch = Math.atan2(dy, Math.hypot(dx, dz))
    input(0, yaw, pitch)
    input(Button.Use, yaw, pitch)
    input(0, yaw, pitch)
  }
  const zombies = () => [...game.players.values()].filter((p) => p.zombie && p.state.alive)
  /** Player 0 takes Hollis' pistol and knife off the cabin table (and stays where they were). */
  const arm = () => {
    const was = { ...player().state.pos }
    const floor = (def.pois[0]?.y ?? 0) + 0.14
    for (const thing of def.starter) {
      move(thing.pos[0] + 0.9, floor, thing.pos[2])
      useAt(...thing.pos)
    }
    move(was.x, was.y, was.z)
  }
  return {
    game,
    def,
    clients,
    ids,
    player,
    last,
    self,
    match,
    run,
    input,
    move,
    useAt,
    zombies,
    arm,
  }
}

describe('survival: the catalogue', () => {
  test('every loot table, quest and shop item exists', () => {
    for (const table of LOOT_TABLES)
      for (const id of tableItems(table)) expect(ITEMS[id]?.id).toBe(id)
    for (const id of TRADER_STOCK) expect(ITEMS[id]?.id).toBe(id)
    for (const q of QUESTS) {
      for (const [item] of q.reward?.items ?? []) expect(ITEMS[item]?.id).toBe(item)
      for (const step of q.steps) {
        if (step.kind === 'fetch') expect(ITEMS[step.item]?.id).toBe(step.item)
        if (step.kind === 'use') {
          for (const [item] of [...(step.needs ?? []), ...(step.gives ?? [])])
            expect(ITEMS[item]?.id).toBe(item)
        }
      }
    }
  })

  test('every survival gun has ammunition, and every weapon an item', () => {
    for (const def of Object.values(WEAPONS)) {
      if (def.id === WeaponId.Claws || def.id === WeaponId.Fists) continue
      if (def.slot !== 'melee') expect(def.ammoType).toBeDefined()
      expect(Object.values(ITEMS).some((i) => i.weapon === def.id)).toBe(true)
    }
  })

  test('the story is one unbroken chain, and everything it points at exists', () => {
    const { def } = setup(0)
    const story = QUESTS.filter((q) => q.story)
    expect(story[0]?.after).toBeUndefined()
    for (let i = 1; i < story.length; i++) expect(story[i]?.after).toBe(story[i - 1]?.id ?? '')
    const missing: string[] = []
    const poi = (key?: string) =>
      key && !def.pois.some((p) => p.key === key) && missing.push(`poi ${key}`)
    const npc = (key?: string) =>
      key && !def.npcs.some((p) => p.key === key) && missing.push(`npc ${key}`)
    const thing = (key: string) =>
      !def.interactables.some((p) => p.key === key) && missing.push(`thing ${key}`)
    for (const q of QUESTS) {
      npc(q.giver)
      for (const step of q.steps) {
        if (step.kind === 'reach' || step.kind === 'hold' || step.kind === 'kill') poi(step.poi)
        if (step.kind === 'talk' || step.kind === 'fetch') npc(step.npc)
        if (step.kind === 'use') {
          thing(step.target)
          poi(step.wakes)
        }
        if (step.kind === 'collect') for (const t of step.targets) thing(t)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('survival: Haven', () => {
  test('nothing solid on the gate road, the ground people wake on, the seats or the people', () => {
    const map = loadMap('deadwood')
    const haven = map.survival?.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    const solid = map.boxes.filter(
      (b) =>
        b.collide !== false &&
        Math.hypot(b.center[0] - haven.x, b.center[2] - haven.z) < haven.r &&
        b.center[1] - b.size[1] / 2 < haven.y + 1.6 &&
        b.center[1] + b.size[1] / 2 > haven.y + 0.3,
    )
    const hits = (x0: number, z0: number, x1: number, z1: number) =>
      solid.filter(
        (b) =>
          Math.abs(b.center[0] - (haven.x + (x0 + x1) / 2)) < b.size[0] / 2 + (x1 - x0) / 2 &&
          Math.abs(b.center[2] - (haven.z + (z0 + z1) / 2)) < b.size[2] / 2 + (z1 - z0) / 2,
      )
    // From inside the gate to the fire, and the ground south of it where people wake.
    expect(hits(-2.4, -29, 2.4, -2.5)).toEqual([])
    expect(hits(-5, 7.5, 5, 11)).toEqual([])
    for (const [x, z] of HAVEN_SEATS)
      expect(hits(x - 0.25, z - 0.25, x + 0.25, z + 0.25)).toEqual([])
    expect(HAVEN_FIRE).toEqual([0, 2])
    for (const n of map.survival?.npcs ?? []) {
      if (Math.hypot(n.pos[0] - haven.x, n.pos[2] - haven.z) > haven.r) continue
      const [x, z] = [n.pos[0] - haven.x, n.pos[2] - haven.z]
      expect(hits(x - 0.3, z - 0.3, x + 0.3, z + 0.3)).toEqual([])
    }
  })
})

describe('survival: the night', () => {
  test('you wake in the cabin with bare fists, a little cash, and a Glock and knife on the table', () => {
    const t = setup()
    t.run(1)
    const s = t.player().state
    expect(s.alive).toBe(true)
    expect(s.weapon.id).toBe(WeaponId.Fists)
    expect(s.holstered).toBeNull()
    expect(s.pocket).toBeNull()
    expect(plain(t.self().inv)).toEqual([{ item: 'water', n: 1 }])
    expect(t.self().money).toBe(START_MONEY)
    // Enough for a box of 9mm and a bottle of water at Gus's, not for a gun.
    const price = (id: string) => (ITEMS[id]?.value ?? 0) * (ITEMS[id]?.kind === 'ammo' ? 10 : 1)
    expect(START_MONEY).toBeGreaterThanOrEqual(price('ammo9') + price('water'))
    expect(START_MONEY).toBeLessThan(price('m1911'))
    // Taking them off the table: the Glock (twelve rounds) in hand, the knife in place of fists.
    t.arm()
    expect(s.weapon.id).toBe(WeaponId.Handgun)
    expect(s.weapon.ammo).toBe(12)
    expect(s.weapon.reserve).toBe(0)
    expect(s.holstered?.id).toBe(WeaponId.Knife)
    expect([s.weapon, s.holstered, s.pocket].some((w) => w?.id === WeaponId.Fists)).toBe(false)
    expect(plain(t.self().inv)).toEqual([{ item: 'water', n: 1 }])
    expect(t.match().survival?.quests[0]?.id).toBe('wake')
    // Standing on the cabin floor, not fallen through the world.
    const start = t.def.pois[0]
    expect(Math.abs(s.pos.y - ((start?.y ?? 0) + 0.12))).toBeLessThan(0.1)
  })

  test("Hollis' pistol and knife: everyone gets their own pair, and only once", () => {
    const t = setup(2)
    t.run(1)
    const told = (i: number) => {
      const shown = new Map<number, string>()
      for (const m of t.clients[i]?.inbox ?? []) {
        if (m.type !== ServerMsg.Loot) continue
        for (const id of m.remove) shown.delete(id)
        for (const l of m.add) shown.set(l.id, l.item)
      }
      return shown
    }
    const starters = (i: number) =>
      [...told(i).entries()].filter(([, item]) => item === 'glock' || item === 'knife')
    // Each sees a Glock and a knife on the table: their own, not the other's.
    expect(
      starters(0)
        .map(([, item]) => item)
        .sort(),
    ).toEqual(['glock', 'knife'])
    expect(
      starters(1)
        .map(([, item]) => item)
        .sort(),
    ).toEqual(['glock', 'knife'])
    const mine = starters(0).map(([id]) => id)
    expect(starters(1).some(([id]) => mine.includes(id))).toBe(false)
    // Player 0 takes theirs: gone for them, still there for player 1.
    t.arm()
    t.run(0.6)
    expect(starters(0)).toEqual([])
    expect(starters(1).length).toBe(2)
    const p0 = t.player(0).state
    expect(p0.weapon.id).toBe(WeaponId.Handgun)
    expect(p0.holstered?.id).toBe(WeaponId.Knife)
    // Trying again finds nothing more to take (no second Glock or knife in the pack).
    t.arm()
    t.run(0.6)
    expect(t.self(0).inv.some((st) => st.item === 'glock' || st.item === 'knife')).toBe(false)
    expect(p0.pocket).toBeNull()
    // Player 1 takes theirs (E, looking at each).
    const p1 = t.player(1)
    const floor = (t.def.pois[0]?.y ?? 0) + 0.14
    let seq = 1
    for (const thing of t.def.starter) {
      p1.state.pos = { x: thing.pos[0] + 0.9, y: floor, z: thing.pos[2] }
      p1.state.vel = { x: 0, y: 0, z: 0 }
      const dx = thing.pos[0] - p1.state.pos.x
      const dy = thing.pos[1] - (p1.state.pos.y + 1.6)
      const dz = thing.pos[2] - p1.state.pos.z
      const yaw = Math.atan2(-dx, -dz)
      const pitch = Math.atan2(dy, Math.hypot(dx, dz))
      for (const buttons of [0, Button.Use, 0]) {
        t.game.handleInput(t.ids[1] ?? 0, [
          { seq: seq++, buttons, yaw, pitch, viewTick: t.game.tick },
        ])
        t.game.step()
      }
    }
    t.run(0.6)
    expect(p1.state.weapon.id).toBe(WeaponId.Handgun)
    expect(p1.state.weapon.ammo).toBe(12)
    expect(p1.state.holstered?.id).toBe(WeaponId.Knife)
    expect(starters(1)).toEqual([])
  })

  test('leaving and coming back: what you took stays taken', () => {
    const t = setup()
    t.run(1)
    t.arm()
    const director = t.game.match as unknown as {
      survival: { onLeave(p: ServerPlayer): void; onJoin(p: ServerPlayer): void }
    }
    const p = t.player()
    director.survival.onLeave(p)
    t.clients[0]?.inbox.splice(0)
    director.survival.onJoin(p)
    t.run(1)
    const again =
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    expect(again.some((l) => l.item === 'glock' || l.item === 'knife')).toBe(false)
  })

  test('loot is put out near you, told to you, and E takes it', () => {
    const t = setup()
    t.run(2)
    const loot =
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    expect(loot.length).toBeGreaterThan(0)
    const item = loot.find(
      (l) => ITEMS[l.item]?.kind !== 'weapon' && ITEMS[l.item]?.kind !== 'money',
    )
    if (!item) throw new Error('nothing to take')
    const start = t.def.pois[0]
    t.move(item.x + 0.9, (start?.y ?? 0) + 0.14, item.z)
    t.useAt(item.x, item.y, item.z)
    t.run(0.1)
    expect(t.self().inv.some((s) => s.item === item.item)).toBe(true)
    const removed = t.clients[0]?.inbox
      .filter((m) => m.type === ServerMsg.Loot)
      .flatMap((m) => m.remove)
    expect(removed).toContain(item.id)
  })

  test('reading the note and reaching Haven moves the story on; Mara talks', () => {
    const t = setup()
    t.run(1)
    const note = t.def.interactables.find((i) => i.key === 'start_note')
    if (!note) throw new Error('no note')
    t.move(note.pos[0] + 1, note.pos[1] - 0.8, note.pos[2])
    t.useAt(...note.pos)
    expect(t.match().survival?.quests[0]?.step).toBe(1)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    t.move(haven.x, haven.y + 0.1, haven.z - 12)
    t.run(1.2)
    const s = t.match().survival
    expect(s?.done).toContain('wake')
    expect(s?.quests[0]?.id).toBe('keep')
    const mara = t.def.npcs.find((n) => n.key === 'mara')
    if (!mara) throw new Error('no mara')
    t.move(mara.pos[0], mara.pos[1], mara.pos[2] - 2)
    t.useAt(mara.pos[0], mara.pos[1] + 1.4, mara.pos[2])
    expect(t.last(ServerMsg.Dialog)?.dialog?.name).toBe('Mara')
    expect(t.match().survival?.quests[0]?.step).toBe(1)
  })

  test('eating, bandaging and wearing a pack work from the backpack', () => {
    const t = setup()
    t.run(1)
    t.arm()
    const d = (
      t.game.match as unknown as { survival: { survivors: Map<number, { self: SurvivalSelf }> } }
    ).survival
    const sv = d.survivors.get(t.ids[0] ?? 0)
    if (!sv) throw new Error('no survivor')
    sv.self.pack = 'pack_school'
    give(sv.self, 'beans', 2)
    give(sv.self, 'pack_hiking', 1)
    give(sv.self, 'ammo9', 30)
    sv.self.hunger = 40
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(sv.self, 'beans') })
    // The bigger pack goes on; the old one, and everything that was in it, goes in it.
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(sv.self, 'pack_hiking') })
    t.run(0.1)
    const self = t.self()
    expect(self.hunger).toBeGreaterThan(65)
    expect(self.pack).toBe('pack_hiking')
    expect(countOf(self.inv, 'beans')).toBe(1)
    expect(countOf(self.inv, 'pack_school')).toBe(1)
    // The Glock sees the 9mm in the pack, and a reload uses it up.
    expect(t.player().state.weapon.reserve).toBe(30)
    t.player().state.weapon.ammo = 2
    for (let i = 0; i < 30; i++) t.input(0) // the draw has to finish first
    t.input(Button.Reload)
    for (let i = 0; i < 2.5 * TICK_RATE; i++) t.input(0)
    expect(t.player().state.weapon.ammo).toBe(12)
    expect(t.self().inv.find((s) => s.item === 'ammo9')?.n).toBe(20)
  })

  test('the dead turn up in the woods around you, but never many', () => {
    const t = setup()
    t.run(1)
    t.move(-300, t.player().state.pos.y, 600)
    t.player().state.pos.y = 40
    t.run(8)
    const n = t.zombies().length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(8)
    for (const z of t.zombies()) {
      const d = Math.hypot(
        z.state.pos.x - t.player().state.pos.x,
        z.state.pos.z - t.player().state.pos.z,
      )
      expect(d).toBeGreaterThan(30)
      expect(z.maxHealth).toBeGreaterThan(100)
    }
  })

  test('a town has many more; a headshot drops them, all but a brute', () => {
    const t = setup()
    t.run(1)
    const town = t.def.pois.find((p) => p.key === 'pinewatch')
    if (!town) throw new Error('no town')
    t.move(town.x + town.r + 60, town.y + 2, town.z)
    t.run(10)
    expect(t.zombies().length).toBeGreaterThanOrEqual(6)
    const walker = t.zombies().find((z) => z.maxHealth >= 200)
    if (!walker) throw new Error('no walker')
    expect(t.game.match.headshotKills(walker)).toBe(true)
    const brute = { ...walker, zombie: { ...walker.zombie, kind: ZombieKind.Brute } }
    expect(t.game.match.headshotKills(brute as typeof walker)).toBe(false)
  })

  test('dying drops everything where you fell; somebody new wakes at Haven', () => {
    const t = setup()
    t.run(1)
    t.arm()
    const sv = survivorOf(t)
    sv.self.pack = 'pack_school'
    give(sv.self, 'beans', 3)
    give(sv.self, 'radio_tube', 1)
    sv.self.wear.body = 'policevest'
    sv.self.money = 75
    sv.self.infected = 400
    const look = t.player().appearance
    t.game.killPlayer(t.ids[0] ?? 0, t.ids[0] ?? 0)
    t.run(0.2)
    // A new character: the start kit, fresh, clean, and the start money again.
    expect(plain(t.self().inv)).toEqual([{ item: 'water', n: 1 }])
    expect(t.self().money).toBe(START_MONEY)
    expect(t.self().pack).toBeNull()
    expect(t.self().wear).toEqual({})
    expect(t.self().infected).toBeNull()
    const dropped =
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    for (const [item, n] of [
      ['beans', 3],
      ['radio_tube', 1],
      ['policevest', 1],
      ['pack_school', 1],
      ['cash', 75],
      ['glock', 1],
      ['knife', 1],
    ] as const) {
      expect(dropped.some((l) => l.item === item && l.n === n)).toBe(true)
    }
    t.run(7)
    const s = t.player().state
    expect(s.alive).toBe(true)
    // Haven spares somebody new a knife; Hollis' pistol is back on the cabin table for them.
    expect(s.weapon.id).toBe(WeaponId.Knife)
    expect(s.holstered).toBeNull()
    const relaid =
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    const table = t.def.starter.find((x) => x.item === 'glock')?.pos ?? [0, 0, 0]
    const onTable = relaid.filter(
      (l) => l.item === 'glock' && Math.hypot(l.x - table[0], l.z - table[2]) < 0.01,
    )
    // Once when they woke, and again for the new them.
    expect(onTable.length).toBe(2)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    expect(Math.hypot(s.pos.x - haven.x, s.pos.z - haven.z)).toBeLessThan(15)
    expect(Math.abs(s.pos.y - haven.y)).toBeLessThan(0.5)
    expect(t.self().hunger).toBe(70)
    // Same face (their chosen appearance), back in the starting outfit: nothing worn.
    expect(t.player().appearance).toBe(look)
    expect(look).toBeDefined()
    expect(t.game.match.gearOf(t.player())).toBe(0)
  })
})

/** The director's insides, for tests that set somebody up. */
type Insides = {
  survivors: Map<number, { self: SurvivalSelf }>
  turned: Map<number, { stuff: { item: string; n: number }[]; look: number }>
  rare: Map<string, number>
  pool: { id: number }[]
}
const insides = (t: ReturnType<typeof setup>) =>
  (t.game.match as unknown as { survival: Insides }).survival
const survivorOf = (t: ReturnType<typeof setup>, i = 0) => {
  const sv = insides(t).survivors.get(t.ids[i] ?? 0)
  if (!sv) throw new Error('no survivor')
  return sv
}

describe('survival: the bite', () => {
  test('a claw that draws blood infects you, once; the clock runs', () => {
    const t = setup()
    t.run(1)
    const zombie = [...t.game.players.values()].find((p) => p.zombie)
    if (!zombie) throw new Error('no zombie')
    expect(t.self().infected).toBeNull()
    t.game.match.onDamage(t.player(), zombie, 10)
    t.run(0.1)
    expect(t.self().infected).toBe(INFECTION_SECONDS)
    t.run(10)
    const sv = survivorOf(t)
    expect(sv.self.infected).toBeGreaterThanOrEqual(INFECTION_SECONDS - 11)
    expect(sv.self.infected).toBeLessThanOrEqual(INFECTION_SECONDS - 9)
    // Another bite doesn't start it over (or make it faster).
    const left = sv.self.infected
    t.game.match.onDamage(t.player(), zombie, 10)
    expect(sv.self.infected).toBe(left)
    // The client hears about it now and then, not every second (other news, like a place found
    // nearby, can add one more).
    const told = t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Survival).length ?? 0
    t.run(10)
    const more =
      (t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Survival).length ?? 0) - told
    expect(more).toBeGreaterThanOrEqual(1)
    expect(more).toBeLessThanOrEqual(5)
  })

  test('adrenaline winds the clock back; the cure ends it', () => {
    const t = setup()
    t.run(1)
    const sv = survivorOf(t)
    const id = t.ids[0] ?? 0
    give(sv.self, 'adrenaline', 1)
    give(sv.self, 'cure', 1)
    // Not infected: the cure isn't wasted.
    t.game.handleAction(id, { a: 'use', from: cellOf(sv.self, 'cure') })
    expect(countOf(sv.self.inv, 'cure')).toBe(1)
    sv.self.infected = 90
    t.game.handleAction(id, { a: 'use', from: cellOf(sv.self, 'adrenaline') })
    expect(sv.self.infected).toBe(INFECTION_SECONDS)
    expect(countOf(sv.self.inv, 'adrenaline')).toBe(0)
    sv.self.infected = 30
    t.game.handleAction(id, { a: 'use', from: cellOf(sv.self, 'cure') })
    expect(sv.self.infected).toBeNull()
    expect(countOf(sv.self.inv, 'cure')).toBe(0)
    t.run(0.1)
    expect(t.self().infected).toBeNull()
  })

  test('the cure is very rare and Gus has it only now and then; he always sells adrenaline', () => {
    const odds = (table: (typeof LOOT_TABLES)[number], item: string) => {
      const random = seeded(3)
      let n = 0
      for (let i = 0; i < 20000; i++) if (rollLoot(table, random)?.item === item) n++
      return n / 20000
    }
    for (const table of ['cache', 'drop', 'military', 'lab'] as const) {
      expect(tableItems(table)).toContain('cure')
      expect(odds(table, 'cure')).toBeLessThan(0.03)
    }
    expect(odds('medical', 'adrenaline')).toBeLessThan(0.02)
    expect(TRADER_STOCK).not.toContain('cure')
    expect(TRADER_STOCK).toContain('adrenaline')
    for (const r of RARE_STOCK) expect(ITEMS[r.item]?.id).toBe(r.item)

    // Today he has a cure: it's on the stall, dear, and once sold it's gone.
    const t = setup()
    t.run(1)
    const gus = t.def.npcs.find((n) => n.role === 'trader')
    if (!gus) throw new Error('no trader')
    const sv = survivorOf(t)
    const id = t.ids[0] ?? 0
    insides(t).rare = new Map([['cure', 1]])
    sv.self.money = 10000
    t.move(gus.pos[0], gus.pos[1], gus.pos[2] - 2)
    t.useAt(gus.pos[0], gus.pos[1] + 1.4, gus.pos[2])
    t.game.handleAction(id, { a: 'choose', npc: gus.key, option: 'shop' })
    const price = RARE_STOCK.find((r) => r.item === 'cure')?.price ?? 0
    expect(t.last(ServerMsg.Dialog)?.dialog?.shop?.[0]).toEqual(['cure', price])
    t.game.handleAction(id, { a: 'buy', item: 'cure', n: 1 })
    expect(countOf(sv.self.inv, 'cure')).toBe(1)
    expect(sv.self.money).toBe(10000 - price)
    t.game.handleAction(id, { a: 'buy', item: 'cure', n: 1 })
    expect(countOf(sv.self.inv, 'cure')).toBe(1)
  })

  test('when the clock runs out you turn: one of the dead walks off with all you had', () => {
    const t = setup(2)
    t.run(1)
    t.arm()
    const sv = survivorOf(t)
    sv.self.pack = 'pack_school'
    give(sv.self, 'beans', 3)
    sv.self.wear.body = 'policevest'
    sv.self.money = 120
    sv.self.infected = 3
    const where = { ...t.player().state.pos }
    t.run(3.5)
    expect(t.player().state.alive).toBe(false)
    // Up it gets, where you stood, with your name, your vest and everything else.
    const risen = [...insides(t).turned.keys()].map((id) => t.game.players.get(id))[0]
    if (!risen) throw new Error('nobody turned')
    expect(risen.state.alive).toBe(true)
    expect(risen.name).toBe('P0 (turned)')
    expect(Math.hypot(risen.state.pos.x - where.x, risen.state.pos.z - where.z)).toBeLessThan(1)
    expect(t.game.match.gearOf(risen)).toBe(gearLooks(['policevest']))
    // Drawn as you (your face and build, dead): everyone is sent your look with the new name.
    expect(risen.appearance).toBe(t.player().appearance)
    const joined = t.clients[1]?.inbox.findLast(
      (m) => m.type === ServerMsg.PlayerJoined && m.id === risen.id,
    )
    expect(joined).toMatchObject({ name: 'P0 (turned)', appearance: t.player().appearance })
    const stuff = insides(t).turned.get(risen.id)?.stuff ?? []
    for (const item of ['beans', 'policevest', 'cash', 'glock', 'knife'])
      expect(stuff.some((s) => s.item === item)).toBe(true)
    // The other player is told, and the new you starts over.
    const told = t.clients[1]?.inbox.some(
      (m) => m.type === ServerMsg.Notice && m.notice.text.includes('P0 turned'),
    )
    expect(told).toBe(true)
    expect(plain(t.self().inv)).toEqual([{ item: 'water', n: 1 }])
    expect(t.self().infected).toBeNull()
    // Put it down: everything spills out where it falls.
    t.game.killPlayer(risen.id, t.ids[1] ?? 0)
    t.run(0.6)
    const loot = (
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    ).filter((l) => Math.hypot(l.x - risen.state.pos.x, l.z - risen.state.pos.z) < 2)
    for (const [item, n] of [
      ['beans', 3],
      ['policevest', 1],
      ['cash', 120],
      ['glock', 1],
    ] as const) {
      expect(loot.some((l) => l.item === item && l.n === n)).toBe(true)
    }
    expect(insides(t).turned.size).toBe(0)
    // And you wake at Haven with the start kit (a knife from the camp) and the start money.
    t.run(7)
    const s = t.player().state
    expect(s.alive).toBe(true)
    expect(s.weapon.id).toBe(WeaponId.Knife)
    expect(t.self().money).toBe(START_MONEY)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    expect(Math.hypot(s.pos.x - (haven?.x ?? 0), s.pos.z - (haven?.z ?? 0))).toBeLessThan(15)
  })

  test('people who die wake at Haven apart, not inside each other', () => {
    const t = setup(2)
    t.run(1)
    for (let round = 0; round < 6; round++) {
      for (const id of t.ids) t.game.killPlayer(id, id)
      t.run(7)
      const people = t.ids.map((id) => t.game.players.get(id)?.state)
      for (const [i, a] of people.entries()) {
        expect(a?.alive).toBe(true)
        for (const b of people.slice(i + 1)) {
          if (!a || !b) throw new Error('nobody')
          expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(1)
        }
        for (const npc of t.def.npcs) {
          if (!a) continue
          expect(Math.hypot(a.pos.x - npc.pos[0], a.pos.z - npc.pos[2])).toBeGreaterThan(1)
        }
      }
    }
  })

  test('turning inside Haven: the guards see to it, and your things stay there', () => {
    const t = setup()
    t.run(1)
    const haven = t.def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no haven')
    t.move(haven.x + 3, haven.y + 0.1, haven.z + 9)
    const sv = survivorOf(t)
    give(sv.self, 'beans', 2)
    sv.self.infected = 2
    t.run(2.5)
    expect(t.player().state.alive).toBe(false)
    expect(insides(t).turned.size).toBe(0)
    const loot =
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    expect(loot.some((l) => l.item === 'beans' && l.n === 2)).toBe(true)
  })
})

describe('survival: the inventory grid', () => {
  /** The newest thing of this kind lying about that player 0 was told of. */
  const groundOf = (t: ReturnType<typeof setup>, item: string) =>
    t.clients[0]?.inbox
      .filter((m) => m.type === ServerMsg.Loot)
      .flatMap((m) => m.add)
      .findLast((l) => l.item === item)

  test('moving, turning, splitting and merging stacks; bad moves change nothing', () => {
    const t = setup()
    t.run(1)
    t.arm()
    const id = t.ids[0] ?? 0
    const me = survivorOf(t).self
    me.pack = 'pack_school' // 5 × 4
    give(me, 'ammo9', 30)
    const act = (from: object, to: object, n?: number) =>
      t.game.handleAction(id, {
        a: 'move',
        from,
        to,
        ...(n !== undefined ? { n } : {}),
      } as Parameters<typeof t.game.handleAction>[1])
    act(cellOf(me, 'ammo9'), { c: 'pack', x: 2, y: 1 })
    expect(me.inv.find((s) => s.item === 'ammo9')).toMatchObject({ c: 'pack', x: 2, y: 1, n: 30 })
    // Ten of them into a stack of their own, then back onto the first.
    act({ c: 'pack', x: 2, y: 1 }, { c: 'pack', x: 0, y: 0 }, 10)
    expect(me.inv.filter((s) => s.item === 'ammo9').map((s) => s.n)).toEqual([20, 10])
    act({ c: 'pack', x: 0, y: 0 }, { c: 'pack', x: 2, y: 1 })
    expect(me.inv.filter((s) => s.item === 'ammo9').map((s) => s.n)).toEqual([30])
    // A can of beans (1 × 2) won't stand up in the bottom row, but lies down there.
    give(me, 'beans', 1)
    const beans = () => me.inv.find((s) => s.item === 'beans')
    const was = { ...cellOf(me, 'beans') }
    act(was, { c: 'pack', x: 4, y: 3 })
    expect(beans()).toMatchObject(was)
    act(was, { c: 'pack', x: 3, y: 3, r: 1 })
    expect(beans()).toMatchObject({ c: 'pack', x: 3, y: 3, r: 1 })
    // Not onto something else, not outside, not without a pack, not with nonsense.
    act({ c: 'pack', x: 3, y: 3 }, { c: 'pack', x: 2, y: 1 })
    act({ c: 'pack', x: 3, y: 3 }, { c: 'pack', x: 5, y: 0 })
    act({ c: 'pack', x: 3, y: 3 }, { c: 'pack', x: -1, y: 0 })
    act({ c: 'pack', x: 3, y: 3 }, { c: 'hat', x: 0, y: 0 })
    act({ c: 'pack', x: 2, y: 1 }, { c: 'pack', x: 0, y: 0 }, -5)
    act({ c: 'pack', x: 2, y: 1 }, { c: 'pack', x: 0.5, y: 0 })
    expect(beans()).toMatchObject({ c: 'pack', x: 3, y: 3, r: 1 })
    expect(me.inv.filter((s) => s.item === 'ammo9').map((s) => [s.x, s.y, s.n])).toEqual([
      [2, 1, 30],
    ])
    // Nothing overlaps anything, anywhere.
    for (const a of me.inv)
      for (const b of me.inv) {
        if (a === b || a.c !== b.c) continue
        const [aw, ah] = [
          a.r ? sizeOf(a.item)[1] : sizeOf(a.item)[0],
          a.r ? sizeOf(a.item)[0] : sizeOf(a.item)[1],
        ]
        const [bw, bh] = [
          b.r ? sizeOf(b.item)[1] : sizeOf(b.item)[0],
          b.r ? sizeOf(b.item)[0] : sizeOf(b.item)[1],
        ]
        expect(a.x < b.x + bw && b.x < a.x + aw && a.y < b.y + bh && b.y < a.y + ah).toBe(false)
      }
    // The Glock sees its rounds wherever they are.
    t.run(0.1)
    expect(t.player().state.weapon.reserve).toBe(30)
  })

  test('dropping to the ground and taking from the vicinity; out of reach is out of reach', () => {
    const t = setup()
    t.run(1)
    const id = t.ids[0] ?? 0
    const me = survivorOf(t).self
    give(me, 'ammo9', 20)
    t.game.handleAction(id, { a: 'move', from: cellOf(me, 'ammo9'), to: { ground: true }, n: 5 })
    expect(countOf(me.inv, 'ammo9')).toBe(15)
    const pile = groundOf(t, 'ammo9')
    if (!pile) throw new Error('nothing dropped')
    expect(pile.n).toBe(5)
    // Back into a pocket, at a cell of your choosing.
    const free = me.inv.some((s) => s.c === 'legs' && s.x === 1 && s.y === 1)
    expect(free).toBe(false)
    t.game.handleAction(id, { a: 'move', from: { g: pile.id }, to: { c: 'legs', x: 1, y: 1 } })
    expect(countOf(me.inv, 'ammo9')).toBe(20)
    expect(
      t.clients[0]?.inbox.some((m) => m.type === ServerMsg.Loot && m.remove.includes(pile.id)),
    ).toBe(true)
    // Dropped again, then walked away from: it can't be taken from over there.
    t.game.handleAction(id, { a: 'move', from: cellOf(me, 'ammo9'), to: { ground: true } })
    const far = groundOf(t, 'ammo9')
    if (!far) throw new Error('nothing dropped')
    const p = t.player().state.pos
    t.move(p.x + 15, p.y, p.z)
    t.game.handleAction(id, { a: 'move', from: { g: far.id }, to: { auto: true } })
    t.game.handleAction(id, { a: 'use', from: { g: far.id } })
    expect(countOf(me.inv, 'ammo9')).toBe(5)
  })

  test('weapons move between the hands and the pockets; bare fists are what is left', () => {
    const t = setup()
    t.run(1)
    t.arm()
    const id = t.ids[0] ?? 0
    const me = survivorOf(t).self
    me.pack = 'pack_hiking'
    const slots = () => carried(t.player().state).map((w) => w.id)
    t.game.handleAction(id, { a: 'move', from: { slot: 'melee' }, to: { auto: true } })
    expect(slots()).toEqual([WeaponId.Handgun, WeaponId.Fists])
    expect(countOf(me.inv, 'knife')).toBe(1)
    // The Glock down too: your fists are left, and they can't be put anywhere.
    t.game.handleAction(id, { a: 'move', from: { slot: 'sidearm' }, to: { ground: true } })
    expect(slots()).toEqual([WeaponId.Fists])
    t.game.handleAction(id, { a: 'move', from: { slot: 'melee' }, to: { ground: true } })
    expect(slots()).toEqual([WeaponId.Fists])
    expect(groundOf(t, 'fists')).toBeUndefined()
    // Picked up again, the Glock goes straight in hand.
    const glock = groundOf(t, 'glock')
    if (!glock) throw new Error('no glock on the ground')
    t.game.handleAction(id, { a: 'use', from: { g: glock.id } })
    expect(slots()).toEqual([WeaponId.Handgun, WeaponId.Fists])
    // A knife into the sidearm slot? No.
    t.game.handleAction(id, { a: 'move', from: cellOf(me, 'knife'), to: { slot: 'sidearm' } })
    expect(countOf(me.inv, 'knife')).toBe(1)
    t.game.handleAction(id, { a: 'use', from: cellOf(me, 'knife') })
    expect(slots()).toContain(WeaponId.Knife)
    // A rifle from the pack into the primary slot keeps its rounds.
    give(me, 'm4', 1, 17)
    t.game.handleAction(id, { a: 'move', from: cellOf(me, 'm4'), to: { slot: 'primary' } })
    const rifle = carried(t.player().state).find((w) => w.id === WeaponId.Rifle)
    expect(rifle?.ammo).toBe(17)
    expect(countOf(me.inv, 'm4')).toBe(0)
  })

  test('clothes: full pockets keep them on, dropped they take it all along, bare slots fill', () => {
    const t = setup()
    t.run(1)
    const id = t.ids[0] ?? 0
    const me = survivorOf(t).self
    me.wear.body = 'jacket'
    give(me, 'ammo22', 10_000)
    const rounds = countOf(me.inv, 'ammo22')
    // Nowhere for what's in the jacket: it stays on.
    t.game.handleAction(id, { a: 'move', from: { slot: 'body' }, to: { auto: true } })
    expect(me.wear.body).toBe('jacket')
    expect(countOf(me.inv, 'ammo22')).toBe(rounds)
    // Thrown on the ground, its pockets go with it.
    t.game.handleAction(id, { a: 'move', from: { slot: 'body' }, to: { ground: true } })
    expect(me.wear.body).toBeUndefined()
    expect(countOf(me.inv, 'ammo22')).toBeLessThan(rounds)
    const jacket = groundOf(t, 'jacket')
    if (!jacket) throw new Error('no jacket on the ground')
    // Picked up again with nothing on your body, it goes straight on.
    t.game.handleAction(id, { a: 'use', from: { g: jacket.id } })
    expect(me.wear.body).toBe('jacket')
  })
})

describe('survival: barricades', () => {
  test('you can board the door up, and the dead batter it down', () => {
    const t = setup()
    t.run(8)
    const start = t.def.pois[0]
    const i = t.def.spots.findIndex((p) => p.poi === 0 && p.door)
    const spot = t.def.spots[i]
    if (!start || !spot) throw new Error('no door at the start cabin')
    // Stand just inside the door, with planks.
    const inX = Math.sign(start.x - spot.x) * (spot.alongX ? 0 : 1)
    const inZ = Math.sign(start.z - spot.z) * (spot.alongX ? 1 : 0)
    t.move(spot.x + inX * 1.3, spot.y + 0.05, spot.z + inZ * 1.3)
    const director = (
      t.game.match as unknown as {
        survival: { survivors: Map<number, { self: SurvivalSelf }> }
      }
    ).survival
    const me = director.survivors.get(t.ids[0] ?? 0)?.self
    if (!me) throw new Error('no survivor')
    me.pack = 'pack_school'
    give(me, 'planks', 5)
    const c = spotCentre(spot)
    for (let k = 0; k < MAX_PLANKS + 1; k++) {
      t.useAt(c.x, c.y, c.z)
      t.run(0.5)
    }
    const boards = () => {
      const b = t.match().survival?.boards ?? []
      const at = b.findIndex((v, k) => k % 2 === 0 && v === i)
      return at < 0 ? 0 : (b[at + 1] ?? 0)
    }
    expect(planksFor(boards())).toBe(MAX_PLANKS)
    expect(boards()).toBe(MAX_PLANKS * PLANK_HP)
    expect(t.game.world.physics.barricades.has(i)).toBe(true)

    // The dead come for you through that door.
    const zombie = t.zombies()[0]
    if (!zombie) throw new Error('no zombie')
    const zed = zombie.zombie as Zed
    zombie.state.pos = { x: spot.x - inX * 1.2, y: spot.y + 0.05, z: spot.z - inZ * 1.2 }
    zombie.state.vel = { x: 0, y: 0, z: 0 }
    // It heard the hammering.
    zed.alert(t.player().state.pos, t.game.tick / TICK_RATE)
    t.run(4)
    expect(boards()).toBeLessThan(MAX_PLANKS * PLANK_HP)
    // It can't walk through while there are planks up.
    const inside = (zombie.state.pos.x - spot.x) * inX + (zombie.state.pos.z - spot.z) * inZ
    expect(inside).toBeLessThan(0)
    t.run(60)
    expect(boards()).toBe(0)
    expect(t.game.world.physics.barricades.has(i)).toBe(false)
  })
})

describe('survival: supply drops', () => {
  test('after the radio works, a helicopter drops a crate near you: loot, a flare and the dead', () => {
    const t = setup()
    t.run(1)
    const director = (
      t.game.match as unknown as {
        survival: {
          done: string[]
          drops: { nextAt: number }
          survivors: Map<number, { self: SurvivalSelf }>
        }
      }
    ).survival
    // Out in the woods, where nothing much lives.
    t.move(-300, 0, 600)
    t.player().state.pos.y = heightAt(t.def.terrain, -300, 600) + 0.1
    const now = () => t.game.tick / TICK_RATE
    // Not before the story gets there, however long you wait.
    director.drops.nextAt = now()
    t.run(3)
    expect(t.match().survival?.drops ?? []).toEqual([])

    director.done.push('wake', 'keep', 'deadair', 'tower')
    director.drops.nextAt = now()
    t.run(1.5)
    const drops = t.match().survival?.drops ?? []
    expect(drops.length).toBe(1)
    const drop = drops[0]
    if (!drop) throw new Error('no drop')
    expect(drop.landed).toBe(false)
    const me = t.player().state.pos
    const d = Math.hypot(drop.x - me.x, drop.z - me.z)
    expect(d).toBeGreaterThanOrEqual(79)
    expect(d).toBeLessThanOrEqual(201)
    expect(openGround(t.def, drop.x, drop.z)).toBe(true)
    expect(Math.abs(drop.y - heightAt(t.def.terrain, drop.x, drop.z))).toBeLessThan(0.2)
    const notices = () =>
      t.clients[0]?.inbox.flatMap((m) => (m.type === ServerMsg.Notice ? [m.notice.text] : [])) ?? []
    expect(notices().some((n) => n.includes('helicopter'))).toBe(true)

    // It comes down, spills its loot, and the dead come for it.
    t.run(DROP_LAND)
    const landed = t.match().survival?.drops?.[0]
    expect(landed?.landed).toBe(true)
    expect(landed?.opened).toBe(false)
    expect(notices().some((n) => n.includes('parachute'))).toBe(true)
    const coming = t.zombies().filter((z) => {
      const zed = z.zombie as Zed
      const goal = zed.lastKnown
      return goal !== null && Math.hypot(goal.x - drop.x, goal.z - drop.z) < 10
    })
    expect(coming.length).toBeGreaterThanOrEqual(3)
    // Walk over (told about the loot once you're near).
    t.move(drop.x + 3, drop.y + 0.1, drop.z)
    t.run(0.6)
    const loot = (
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    ).filter((l) => Math.hypot(l.x - drop.x, l.z - drop.z) < 2)
    expect(loot.length).toBeGreaterThanOrEqual(5)
    expect(loot.some((l) => ITEMS[l.item]?.kind === 'weapon')).toBe(true)

    // E takes from it, and then it's been opened.
    // (Not something worn: clothes and packs go straight on when that slot is bare.)
    const item = loot.find((l) => !['weapon', 'wear', 'pack'].includes(ITEMS[l.item]?.kind ?? ''))
    if (!item) throw new Error('nothing to take')
    director.survivors.get(t.ids[0] ?? 0)?.self.inv.splice(0)
    t.move(item.x + 0.9, item.y + 0.05, item.z)
    t.useAt(item.x, item.y, item.z)
    t.run(1.1)
    expect(t.self().inv.some((s) => s.item === item.item)).toBe(true)
    expect(t.match().survival?.drops?.[0]?.opened).toBe(true)
  })
})

describe('survival: clothes and gear', () => {
  test('wearing a vest adds pockets and armour, shows on you, and comes off again', () => {
    const t = setup(2)
    t.run(1)
    const director = (
      t.game.match as unknown as {
        survival: { survivors: Map<number, { self: SurvivalSelf }> }
      }
    ).survival
    const me = director.survivors.get(t.ids[0] ?? 0)?.self
    if (!me) throw new Error('no survivor')
    me.pack = 'pack_military'
    give(me, 'militaryvest', 1)
    give(me, 'helmet', 1)
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(me, 'militaryvest') })
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(me, 'helmet') })
    expect(me.wear.body).toBe('militaryvest')
    expect(me.wear.head).toBe('helmet')
    // Its pouches are a much bigger pocket grid than the tank top's.
    expect(gridOf(me, 'body')).toEqual([4, 3])
    // Armour: a helmet takes 45 % off a head hit, the vest 40 % off a body hit.
    expect(t.game.match.armour(t.player(), true, 100)).toBe(55)
    expect(t.game.match.armour(t.player(), false, 100)).toBe(60)
    // The other player sees the helmet and the vest.
    t.run(0.5)
    const snap = t.last(ServerMsg.Snapshot, 1)
    const seen = snap?.players.find((p) => p.id === t.ids[0])
    expect(seen?.gear).toBe(gearLooks(['helmet', 'militaryvest']))
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: { slot: 'head' } })
    expect(me.wear.head).toBeUndefined()
    expect(countOf(me.inv, 'helmet')).toBe(1)
  })

  test('a new character wears only the tank top and joggers; trousers and shoes go on and off', () => {
    const t = setup(2)
    t.run(1)
    const director = (
      t.game.match as unknown as {
        survival: { survivors: Map<number, { self: SurvivalSelf }> }
      }
    ).survival
    const me = director.survivors.get(t.ids[0] ?? 0)?.self
    if (!me) throw new Error('no survivor')
    // Nothing worn: everyone sees the starting outfit (all looks 0, barefoot).
    expect(me.wear).toEqual({})
    t.run(0.2)
    const seenBefore = t.last(ServerMsg.Snapshot, 1)?.players.find((p) => p.id === t.ids[0])
    expect(seenBefore?.gear ?? 0).toBe(0)
    me.pack = 'pack_military'
    give(me, 'cargopants', 1)
    give(me, 'jeans', 1)
    give(me, 'boots', 1)
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(me, 'cargopants') })
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(me, 'boots') })
    expect(me.wear.legs).toBe('cargopants')
    expect(me.wear.feet).toBe('boots')
    expect(gridOf(me, 'legs')).toEqual([4, 2])
    // Swapping trousers puts the old pair in the pack.
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', from: cellOf(me, 'jeans') })
    expect(me.wear.legs).toBe('jeans')
    expect(countOf(me.inv, 'cargopants')).toBe(1)
    t.run(0.2)
    const seen = t.last(ServerMsg.Snapshot, 1)?.players.find((p) => p.id === t.ids[0])
    expect(seen?.gear).toBe(gearLooks(['jeans', 'boots']))
    expect(legsLook(seen?.gear ?? 0)).toBe(LEGS_LOOKS.jeans)
    expect(feetLook(seen?.gear ?? 0)).toBe(FEET_LOOKS.boots)
    t.game.handleAction(t.ids[0] ?? 0, { a: 'move', from: { slot: 'legs' }, to: { auto: true } })
    expect(me.wear.legs).toBeUndefined()
    expect(countOf(me.inv, 'jeans')).toBe(1)
  })

  test('the loot tables hand out clothes, and there are more guns about', () => {
    for (const table of ['bedroom', 'store', 'police', 'military', 'hunting'] as const) {
      expect(tableItems(table).some((id) => ITEMS[id]?.kind === 'wear')).toBe(true)
    }
    // Trousers and shoes turn up wherever people kept clothes.
    const slotOf = (id: string) => GEAR[id]?.slot
    for (const table of [
      'bedroom',
      'store',
      'garage',
      'police',
      'military',
      'hunting',
      'camp',
    ] as const) {
      expect(tableItems(table).some((id) => slotOf(id) === 'legs')).toBe(true)
      expect(tableItems(table).some((id) => slotOf(id) === 'feet')).toBe(true)
    }
    expect(TRADER_STOCK.some((id) => slotOf(id) === 'legs')).toBe(true)
    expect(tableItems('bedroom').some((id) => ITEMS[id]?.kind === 'weapon')).toBe(true)
  })

  test('most homes keep a gun, and only a cheap one', () => {
    const def = loadMap('deadwood').survival
    if (!def) throw new Error('no survival world')
    // Every lone house, cabin and camper has a spot for it (and so do the homes in town).
    const homes = def.pois.flatMap((p, i) =>
      p.kind === 'house' || p.kind === 'cabin' || p.kind === 'camper' ? [i] : [],
    )
    expect(homes.length).toBeGreaterThan(50)
    for (const i of homes)
      expect(def.loot.some((l) => l.poi === i && l.table === 'homegun')).toBe(true)
    expect(def.loot.filter((l) => l.table === 'homegun').length).toBeGreaterThan(75)
    // Pistols and old shotguns: no rifles, nothing military.
    for (const id of tableItems('homegun')) {
      const weapon = ITEMS[id]?.weapon
      expect(weapon).toBeDefined()
      const ammo = WEAPONS[weapon as WeaponId].ammoType
      expect(['9mm', '.22', '.45', '.357', '12ga']).toContain(ammo as string)
      expect(ITEMS[id]?.value ?? 0).toBeLessThanOrEqual(400)
    }
    // About four homes in five still have it.
    const random = seeded(5)
    let found = 0
    for (let i = 0; i < 20000; i++) if (rollLoot('homegun', random)) found++
    expect(found / 20000).toBeGreaterThan(0.7)
    expect(found / 20000).toBeLessThan(0.85)
  })

  test('a gun lies with a few of its own rounds beside it', () => {
    const random = seeded(9)
    for (const [id, def] of Object.entries(ITEMS)) {
      if (def.kind !== 'weapon' || def.weapon === undefined) continue
      const beside = ammoBeside(id, random)
      const type = WEAPONS[def.weapon].ammoType
      if (!type) {
        expect(beside).toBeNull()
        continue
      }
      expect(ITEMS[beside?.item ?? '']?.ammo).toBe(type)
      expect(beside?.n).toBeGreaterThanOrEqual(2)
      expect(beside?.n).toBeLessThanOrEqual(12)
    }
    expect(ammoBeside('beans', random)).toBeNull()

    // In the world: walk past some houses and look at what was put out.
    const t = setup()
    const houses = t.def.pois.filter((p) => p.kind === 'house').slice(0, 8)
    const seen = () =>
      t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    for (const h of houses) {
      t.move(h.x, h.y + 0.14, h.z)
      t.run(0.5)
    }
    const loot = seen()
    const guns = loot.filter((l) => {
      const weapon = ITEMS[l.item]?.weapon
      const inHouse = houses.some((h) => Math.hypot(l.x - h.x, l.z - h.z) < h.r)
      return weapon !== undefined && WEAPONS[weapon].ammoType !== undefined && inHouse
    })
    expect(guns.length).toBeGreaterThan(3)
    for (const g of guns) {
      const type = WEAPONS[ITEMS[g.item]?.weapon as WeaponId].ammoType
      const near = loot.some(
        (l) => ITEMS[l.item]?.ammo === type && l.n <= 12 && Math.hypot(l.x - g.x, l.z - g.z) < 0.35,
      )
      expect(near).toBe(true)
    }
  })

  test('ammunition turns up a good deal more often in ordinary places', () => {
    const ammoOdds = (table: (typeof LOOT_TABLES)[number]) => {
      const random = seeded(4)
      let n = 0
      for (let i = 0; i < 20000; i++) {
        const roll = rollLoot(table, random)
        if (roll && ITEMS[roll.item]?.kind === 'ammo') n++
      }
      return n / 20000
    }
    // Before: kitchens ~1%, bedrooms ~12%, garages ~3%, shops none, camps ~8%.
    expect(ammoOdds('kitchen')).toBeGreaterThan(0.04)
    expect(ammoOdds('bedroom')).toBeGreaterThan(0.2)
    expect(ammoOdds('garage')).toBeGreaterThan(0.07)
    expect(ammoOdds('store')).toBeGreaterThan(0.04)
    expect(ammoOdds('camp')).toBeGreaterThan(0.11)
    // Still a handful at a time, so the trader's boxes are worth buying.
    for (const table of ['kitchen', 'bedroom', 'garage', 'store', 'office', 'camp'] as const) {
      const random = seeded(6)
      for (let i = 0; i < 4000; i++) {
        const roll = rollLoot(table, random)
        if (roll && ITEMS[roll.item]?.kind === 'ammo') expect(roll.n).toBeLessThanOrEqual(16)
      }
    }
  })
})

describe('survival: weather', () => {
  test('everybody is told the weather, it runs on, and an admin can hold it', () => {
    const t = setup()
    t.run(2)
    const first = t.match().survival?.weather
    if (!first) throw new Error('no weather')
    expect(first.kind).toBe(weatherAt(first.seed, first.clock).kind)
    expect(first.clock).toBeGreaterThan(1.5)
    t.run(3)
    const later = t.match().survival?.weather
    expect(later?.seed).toBe(first.seed)
    expect((later?.clock ?? 0) - first.clock).toBeCloseTo(3, 1)
    expect(t.game.match.pinWeather('storm')).toBe(true)
    const pinned = t.match().survival?.weather
    expect(pinned?.pin).toBe('storm')
    expect(pinned?.kind).toBe('storm')
    t.game.match.pinWeather(null)
    expect(t.match().survival?.weather?.pin).toBeUndefined()
  })

  test('rain drowns out footsteps and shots: the dead hear you from less far', () => {
    const t = setup()
    t.run(1)
    t.arm()
    const director = (
      t.game.match as unknown as {
        survival: { heardFrom(p: ServerPlayer): number; pinWeather(k: WeatherKind | null): void }
      }
    ).survival
    const me = t.player()
    me.state.vel = { x: 7, y: 0, z: 0 }
    director.pinWeather('clear')
    const dry = director.heardFrom(me)
    // Running pace (16 m), barefoot (new characters have no shoes).
    expect(dry).toBeCloseTo(16 * (1 + BAREFOOT_NOISE), 5)
    director.pinWeather('rain')
    const wet = director.heardFrom(me)
    director.pinWeather('storm')
    const storm = director.heardFrom(me)
    expect(wet).toBeLessThan(dry * 0.75)
    expect(storm).toBeLessThan(wet)
    // A shot carries further than steps, rain or not, but rain shortens it too.
    t.game.match.onShot(me)
    const shotInStorm = director.heardFrom(me)
    director.pinWeather('clear')
    expect(director.heardFrom(me)).toBeGreaterThan(shotInStorm)
    expect(shotInStorm).toBeGreaterThan(storm)
  })
})

describe('survival: dodging a blow', () => {
  /**
   * Player 0 in the open woods, facing a walker that stands 1.4 m in front of them and is coming
   * for them (every other zombie put away). `step(buttons)` is one tick of player 0's input.
   */
  const duel = (kind: ZombieKind = ZombieKind.Walker) => {
    const t = setup()
    t.run(1)
    let spot: { x: number; y: number; z: number } | null = null
    for (let i = 0; i < 4000 && !spot; i++) {
      const x = ((i * 137) % 2400) - 1200
      const z = ((i * 211) % 2400) - 1200
      if (!openGround(t.def, x, z, 0.5)) continue
      if (t.def.pois.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 60)) continue
      const y = heightAt(t.def.terrain, x, z)
      const flat = [-3, 3].every(
        (d) =>
          Math.abs(heightAt(t.def.terrain, x + d, z) - y) < 0.25 &&
          Math.abs(heightAt(t.def.terrain, x, z + d) - y) < 0.25,
      )
      if (flat) spot = { x, y, z }
    }
    if (!spot) throw new Error('no open ground')
    for (const z of t.zombies()) t.game.retireZombie(z)
    t.move(spot.x, spot.y + 0.05, spot.z)
    const me = t.player()
    me.protectedUntil = 0
    me.state.yaw = 0 // facing -z, at the zombie
    const zombie = [...t.game.players.values()].find((p) => p.zombie) as ServerPlayer
    const zed = zombie.zombie as Zed
    zed.reset(kind, -1, false)
    t.game.placeZombie(zombie, { pos: [spot.x, spot.y + 0.05, spot.z - 1.4], yaw: Math.PI }, 5000)
    zed.speedChanged()
    t.game.applyRules(zombie)
    zed.mood = 'chase'
    zed.targetId = me.id
    zed.lastKnown = { ...me.state.pos }
    const health = () => t.game.players.get(me.id)?.health ?? 0
    const step = (buttons = 0) => {
      // Keep it one on one: nothing else wanders in.
      for (const z of t.zombies()) if (z !== zombie) t.game.retireZombie(z)
      t.input(buttons, me.state.yaw, 0)
    }
    /** Ticks until the zombie starts winding up (fails after 2 s). */
    const untilWindup = () => {
      for (let i = 0; i < 2 * TICK_RATE; i++) {
        if (zed.windup > 0) return i
        step()
      }
      throw new Error('it never wound up')
    }
    return { t, me, zombie, zed, health, step, untilWindup }
  }
  const WALKER = CLAW_TIMING[ZombieKind.Walker]?.windup ?? 0
  const ticks = (seconds: number) => Math.round(seconds * TICK_RATE)
  /** A person sees the wind-up this late: reaction time plus a fair ping (s). */
  const REACTION = 0.3
  const react = (d: ReturnType<typeof duel>) => {
    for (let i = 0; i < ticks(REACTION); i++) d.step()
  }

  test('standing in front of it: the blow lands once the wind-up is done', () => {
    const d = duel()
    d.untilWindup()
    const before = d.health()
    // All through the wind-up nothing happens…
    for (let i = 0; i < ticks(WALKER) - 3; i++) d.step()
    expect(d.zed.windup).toBeGreaterThan(0.8)
    expect(d.health()).toBe(before)
    // …then the claws come down, and draw blood: bitten.
    for (let i = 0; i < 6; i++) d.step()
    expect(d.health()).toBeLessThan(before)
    expect(survivorOf(d.t).self.infected).toBe(INFECTION_SECONDS)
  })

  test('backing off during the wind-up: it claws at air', () => {
    const d = duel()
    d.untilWindup()
    const before = d.health()
    react(d)
    for (let i = 0; i < ticks(0.3); i++) d.step(Button.Back)
    for (let i = 0; i < ticks(WALKER); i++) d.step()
    expect(d.health()).toBe(before)
    expect(survivorOf(d.t).self.infected).toBeNull()
  })

  test('sidestepping during the wind-up: it claws at air', () => {
    const d = duel()
    d.untilWindup()
    const before = d.health()
    react(d)
    for (let i = 0; i < ticks(0.35); i++) d.step(Button.Left)
    for (let i = 0; i < ticks(WALKER); i++) d.step()
    expect(d.health()).toBe(before)
    expect(survivorOf(d.t).self.infected).toBeNull()
  })

  test('after a miss it stands there, open to the knife, then comes again', () => {
    const d = duel()
    d.untilWindup()
    react(d)
    for (let i = 0; i < ticks(0.3); i++) d.step(Button.Back)
    // Wait for the strike (the wind-up runs out), then step right back in front of it.
    while (d.zed.windup > 0) d.step()
    d.step()
    const at = { ...d.zombie.state.pos }
    const yaw = d.zombie.state.yaw
    const before = d.health()
    for (let i = 0; i < ticks(0.15); i++) d.step(Button.Forward)
    const recover = CLAW_TIMING[ZombieKind.Walker]?.recover ?? 0
    for (let i = 0; i < ticks(recover - 0.3); i++) {
      d.step()
      expect(d.zed.windup).toBe(0)
    }
    // Off balance: it hasn't moved, turned or touched you.
    expect(Math.hypot(d.zombie.state.pos.x - at.x, d.zombie.state.pos.z - at.z)).toBeLessThan(0.05)
    expect(d.zombie.state.yaw).toBeCloseTo(yaw, 5)
    expect(d.health()).toBe(before)
    // Once it has its balance back it comes at you again.
    for (let i = 0; i < ticks(1) && d.zed.windup === 0; i++) d.step()
    expect(d.zed.windup).toBeGreaterThan(0)
  })

  test('a runner hardly winds up at all', () => {
    expect(CLAW_TIMING[ZombieKind.Runner]?.windup ?? 1).toBeLessThan(WALKER / 1.5)
    const d = duel(ZombieKind.Runner)
    d.untilWindup()
    const before = d.health()
    // The same back-off that beats a walker is too late for it.
    react(d)
    for (let i = 0; i < ticks(0.3); i++) d.step(Button.Back)
    expect(d.health()).toBeLessThan(before)
  })
})

describe('a full camp', () => {
  test('people joining a running world push the dead out cleanly; nothing throws', () => {
    const t = setup(1)
    t.run(2)
    // Late arrivals: each one bumps one of the dead out of its slot.
    for (let i = 0; i < 6; i++) {
      t.game.join(`Late${i}`, { send: () => {} })
      t.run(1)
    }
    // The dead die and get stood back up somewhere else, over and over.
    for (let round = 0; round < 4; round++) {
      for (const z of t.zombies()) t.game.killPlayer(z.id, z.id)
      t.run(8)
    }
    const people = [...t.game.players.values()].filter((p) => !p.zombie)
    expect(people.length).toBe(7)
    expect(t.game.players.size).toBeLessThanOrEqual(MAX_PLAYERS)
    // None of the dead the game let go of linger in the director.
    expect(insides(t).pool.every((z) => t.game.players.has(z.id))).toBe(true)
    // And as they leave again, the dead come back up to strength.
    for (const p of people.slice(1)) t.game.leave(p.id)
    t.run(10)
    const pool = insides(t).pool
    // Back to strength, bar the two places kept free for people.
    expect(pool.length).toBeGreaterThanOrEqual(POOL - 2)
    expect(pool.every((z) => t.game.players.has(z.id))).toBe(true)
  })
})

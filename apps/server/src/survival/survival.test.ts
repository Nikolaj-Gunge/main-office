import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  DEFAULT_RULES,
  decodeServerMessage,
  initPhysics,
  ITEMS,
  LOOT_TABLES,
  loadMap,
  type MatchInfo,
  mergeRules,
  QUESTS,
  type ServerMessage,
  ServerMsg,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
  TRADER_STOCK,
  tableItems,
  WEAPONS,
  WeaponId,
} from '@office-fps/shared'
import { Game } from '../game.ts'

beforeAll(async () => {
  await initPhysics()
})

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
    clients[i]?.inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1)
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
  return { game, def, clients, ids, player, last, self, match, run, input, move, useAt, zombies }
}

describe('survival: the catalogue', () => {
  test('every loot table, quest and shop item exists', () => {
    for (const table of LOOT_TABLES) for (const id of tableItems(table)) expect(ITEMS[id]?.id).toBe(id)
    for (const id of TRADER_STOCK) expect(ITEMS[id]?.id).toBe(id)
    for (const q of QUESTS) {
      for (const [item] of q.reward?.items ?? []) expect(ITEMS[item]?.id).toBe(item)
      for (const step of q.steps) {
        if (step.kind === 'fetch') expect(ITEMS[step.item]?.id).toBe(step.item)
        if (step.kind === 'use') {
          for (const [item] of [...(step.needs ?? []), ...(step.gives ?? [])]) expect(ITEMS[item]?.id).toBe(item)
        }
      }
    }
  })

  test('every survival gun has ammunition, and every weapon an item', () => {
    for (const def of Object.values(WEAPONS)) {
      if (def.id === WeaponId.Claws) continue
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
    const poi = (key?: string) => key && !def.pois.some((p) => p.key === key) && missing.push(`poi ${key}`)
    const npc = (key?: string) => key && !def.npcs.some((p) => p.key === key) && missing.push(`npc ${key}`)
    const thing = (key: string) => !def.interactables.some((p) => p.key === key) && missing.push(`thing ${key}`)
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

describe('survival: the night', () => {
  test('you wake in the cabin with a Glock, twelve rounds and a knife', () => {
    const t = setup()
    t.run(1)
    const s = t.player().state
    expect(s.alive).toBe(true)
    expect(s.weapon.id).toBe(WeaponId.Handgun)
    expect(s.weapon.ammo).toBe(12)
    expect(s.weapon.reserve).toBe(0)
    expect(s.holstered?.id).toBe(WeaponId.Knife)
    expect(t.self().inv).toEqual([{ item: 'water', n: 1 }])
    expect(t.match().survival?.quests[0]?.id).toBe('wake')
    // Standing on the cabin floor, not fallen through the world.
    const start = t.def.pois[0]
    expect(Math.abs(s.pos.y - ((start?.y ?? 0) + 0.12))).toBeLessThan(0.1)
  })

  test('loot is put out near you, told to you, and E takes it', () => {
    const t = setup()
    t.run(2)
    const loot = t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    expect(loot.length).toBeGreaterThan(0)
    const item = loot.find((l) => ITEMS[l.item]?.kind !== 'weapon' && ITEMS[l.item]?.kind !== 'money')
    if (!item) throw new Error('nothing to take')
    const start = t.def.pois[0]
    t.move(item.x + 0.9, (start?.y ?? 0) + 0.14, item.z)
    t.useAt(item.x, item.y, item.z)
    t.run(0.1)
    expect(t.self().inv.some((s) => s.item === item.item)).toBe(true)
    const removed = t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.remove)
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
    const d = (t.game.match as unknown as { survival: { survivors: Map<number, { self: SurvivalSelf }> } }).survival
    const sv = d.survivors.get(t.ids[0] ?? 0)
    if (!sv) throw new Error('no survivor')
    sv.self.inv.push({ item: 'beans', n: 2 }, { item: 'pack_hiking', n: 1 }, { item: 'ammo9', n: 30 })
    sv.self.hunger = 40
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', item: 'beans' })
    t.game.handleAction(t.ids[0] ?? 0, { a: 'use', item: 'pack_hiking' })
    t.run(0.1)
    const self = t.self()
    expect(self.hunger).toBeGreaterThan(65)
    expect(self.pack).toBe('pack_hiking')
    expect(self.inv.find((s) => s.item === 'beans')?.n).toBe(1)
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
      const d = Math.hypot(z.state.pos.x - t.player().state.pos.x, z.state.pos.z - t.player().state.pos.z)
      expect(d).toBeGreaterThan(30)
      expect(z.maxHealth).toBeGreaterThan(100)
    }
  })

  test('a town has many more, and a headshot does not kill outright', () => {
    const t = setup()
    t.run(1)
    const town = t.def.pois.find((p) => p.key === 'pinewatch')
    if (!town) throw new Error('no town')
    t.move(town.x + town.r + 60, town.y + 2, town.z)
    t.run(10)
    expect(t.zombies().length).toBeGreaterThanOrEqual(6)
    const walker = t.zombies().find((z) => z.maxHealth >= 200)
    if (!walker) throw new Error('no walker')
    expect(t.game.match.headshotKills(walker)).toBe(false)
  })

  test('dying drops the backpack where you fell and wakes you up at the start', () => {
    const t = setup()
    t.run(1)
    const d = (t.game.match as unknown as { survival: { survivors: Map<number, { self: SurvivalSelf }> } }).survival
    d.survivors.get(t.ids[0] ?? 0)?.self.inv.push({ item: 'beans', n: 3 })
    t.game.killPlayer(t.ids[0] ?? 0, t.ids[0] ?? 0)
    t.run(0.2)
    expect(t.self().inv).toEqual([])
    t.run(7)
    expect(t.player().state.alive).toBe(true)
    expect(t.player().state.weapon.id).toBe(WeaponId.Handgun)
    const dropped = t.clients[0]?.inbox.filter((m) => m.type === ServerMsg.Loot).flatMap((m) => m.add) ?? []
    expect(dropped.some((l) => l.item === 'beans' && l.n === 3)).toBe(true)
  })
})

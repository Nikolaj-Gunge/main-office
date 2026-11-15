import { beforeAll, describe, expect, test } from 'bun:test'
import {
  countOf,
  createPhysicsWorld,
  DEFAULT_RULES,
  EVAC_HOLD,
  EVAC_INBOUND,
  EVAC_ITEMS,
  EVAC_LEASH,
  EVAC_TOTAL,
  evacHeliPos,
  evacMissing,
  evacPad,
  evacPhase,
  give,
  initPhysics,
  LEGACY_CAP,
  LEGACY_MONEY,
  legacyKit,
  loadMap,
  mergeRules,
  RETIRED_SHOWN,
  type SurvivalSelf,
  seeded,
  TICK_RATE,
} from '@office-fps/shared'
import { Game, type ServerPlayer } from '../game.ts'
import { MemoryStore } from '../saves.ts'
import { START_MONEY, type SurvivalDirector } from './director.ts'
import { evacAccount } from './evac.ts'

beforeAll(async () => {
  await initPhysics()
})

const def = () => {
  const d = loadMap('deadwood').survival
  if (!d) throw new Error('no survival map')
  return d
}

describe('evacuation rules', () => {
  test('the radio wants all three things', () => {
    expect(evacMissing(() => 0)).toEqual([...EVAC_ITEMS])
    expect(evacMissing((i) => (i === 'flaregun' ? 1 : 0))).toEqual(['evacbattery', 'evacpapers'])
    expect(evacMissing(() => 1)).toEqual([])
  })

  test('the hold comes first, then the helicopter, then it is gone', () => {
    expect(evacPhase(0)).toBe('hold')
    expect(evacPhase(EVAC_HOLD - 0.1)).toBe('hold')
    expect(evacPhase(EVAC_HOLD + 1)).toBe('inbound')
    expect(evacPhase(EVAC_HOLD + EVAC_INBOUND + 1)).toBe('landed')
    expect(evacPhase(EVAC_TOTAL - 1)).toBe('outbound')
    expect(evacPhase(EVAC_TOTAL + 1)).toBe('gone')
    // Between two and three minutes of holding.
    expect(EVAC_HOLD).toBeGreaterThanOrEqual(120)
    expect(EVAC_HOLD).toBeLessThanOrEqual(180)
  })

  test('the helicopter is out of sight during the hold and sits on the pad once landed', () => {
    const pad = { x: 10, y: 5, z: -20, heading: 1 }
    expect(evacHeliPos(pad, 10)).toBeNull()
    const down = evacHeliPos(pad, EVAC_HOLD + EVAC_INBOUND + 5)
    expect(down).toEqual({ x: 10, y: 5, z: -20 })
    const coming = evacHeliPos(pad, EVAC_HOLD + 2)
    expect(coming && coming.y - pad.y).toBeGreaterThan(30)
    expect(evacHeliPos(pad, EVAC_TOTAL + 1)).toBeNull()
  })

  test('the helipad is on the radio tower hill, far from Haven, with its radio beside it', () => {
    const d = def()
    const pad = evacPad(d)
    const radio = d.pois.find((p) => p.key === 'radio')
    const haven = d.pois.find((p) => p.key === 'haven')
    if (!pad || !radio || !haven) throw new Error('missing')
    expect(Math.hypot(pad.x - radio.x, pad.z - radio.z)).toBeLessThan(radio.r)
    expect(Math.hypot(pad.x - haven.x, pad.z - haven.z)).toBeGreaterThan(700)
    const set = d.interactables.find((i) => i.key === 'evac_radio')
    expect(set && Math.hypot(set.pos[0] - pad.x, set.pos[2] - pad.z)).toBeLessThan(10)
  })

  test('the bonus grows with each one got out, up to a cap', () => {
    expect(legacyKit(0)).toEqual({ money: 0, items: [] })
    const one = legacyKit(1)
    expect(one.money).toBe(LEGACY_MONEY)
    expect(one.items.length).toBeGreaterThan(0)
    expect(legacyKit(LEGACY_CAP + 5)).toEqual(legacyKit(LEGACY_CAP))
    expect(legacyKit(2).items.length).toBeGreaterThan(one.items.length)
  })
})

interface Insides {
  survivors: Map<number, { self: SurvivalSelf }>
}

async function server(store = new MemoryStore()) {
  const map = loadMap('deadwood')
  const game = new Game(map, createPhysicsWorld(map), seeded(11))
  game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
  await game.useSaves(store)
  const director = (game.match as unknown as { survival: SurvivalDirector }).survival
  const insides = director as unknown as Insides
  const join = async (name: string, account?: string): Promise<ServerPlayer> => {
    if (account) {
      await game.saves.loadCharacter(account)
      await game.saves.loadAccount(account)
    }
    const id = game.join(name, { send: () => {}, ...(account ? { account } : {}) })
    const p = id === null ? undefined : game.players.get(id)
    if (!p) throw new Error('no player')
    p.protectedUntil = Number.POSITIVE_INFINITY
    return p
  }
  const sv = (p: ServerPlayer) => {
    const s = insides.survivors.get(p.id)
    if (!s) throw new Error('not a survivor')
    return { player: p, self: s.self }
  }
  const pad = evacPad(def())
  if (!pad) throw new Error('no pad')
  /** Runs `seconds`, keeping `p` standing on the pad (the dead push). */
  const hold = (p: ServerPlayer, seconds: number) => {
    for (let s = 0; s < seconds; s++) {
      p.state.pos = { x: pad.x, y: pad.y + 0.1, z: pad.z }
      p.health = p.maxHealth
      for (let i = 0; i < TICK_RATE; i++) game.step()
    }
  }
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) game.step()
  }
  return { game, director, join, sv, pad, hold, run, store }
}

const pack = (self: SurvivalSelf) => {
  self.inv = []
  self.pack = 'pack_military'
  for (const item of EVAC_ITEMS) give(self, item, 1)
}

describe('evacuation on the server', () => {
  test('without the three things the radio does nothing', async () => {
    const { director, join, sv } = await server()
    const p = await join('Ann', 'acc-a')
    sv(p).self.inv = []
    give(sv(p).self, 'evacbattery', 1)
    director.evac.use(sv(p))
    expect(director.evac.shared()).toBeUndefined()
    expect(countOf(sv(p).self.inv, 'evacbattery')).toBe(1)
  })

  test('calling it in uses the battery and the flare, and the dead come for the pad', async () => {
    const { director, join, sv, hold, game } = await server()
    const p = await join('Ann', 'acc-a')
    pack(sv(p).self)
    hold(p, 1)
    director.evac.use(sv(p))
    const e = director.evac.shared()
    expect(e?.by).toBe(sv(p).self.bio?.name)
    expect(countOf(sv(p).self.inv, 'evacbattery')).toBe(0)
    expect(countOf(sv(p).self.inv, 'flaregun')).toBe(0)
    expect(countOf(sv(p).self.inv, 'evacpapers')).toBe(1)
    hold(p, 30)
    // The dead are out and coming.
    const zeds = [...game.players.values()].filter((z) => z.zombie && z.state.alive)
    expect(zeds.length).toBeGreaterThan(3)
    expect(director.info().evac?.age).toBeGreaterThan(29)
  }, 60000)

  test('leaving the pad during the hold calls it off', async () => {
    const { director, join, sv, hold, pad, run } = await server()
    const p = await join('Ann', 'acc-a')
    pack(sv(p).self)
    hold(p, 1)
    director.evac.use(sv(p))
    hold(p, 5)
    p.state.pos = { x: pad.x + EVAC_LEASH + 30, y: pad.y + 5, z: pad.z }
    run(2)
    expect(director.evac.shared()).toBeUndefined()
  }, 60000)

  test('holding through and boarding retires the character, who stays at Haven', async () => {
    const store = new MemoryStore()
    const { director, join, sv, hold, run, game } = await server(store)
    const p = await join('Ann', 'acc-a')
    pack(sv(p).self)
    const name = sv(p).self.bio?.name ?? ''
    expect(name.length).toBeGreaterThan(0)
    hold(p, 1)
    director.evac.use(sv(p))
    hold(p, EVAC_HOLD + EVAC_INBOUND)
    // Down on the pad: still standing on it, they get aboard.
    run(3)

    // Somebody new, at Haven, with what the one before left them.
    const now = sv(p).self
    expect(now.bio?.name).not.toBe(name)
    expect(countOf(now.inv, 'evacpapers')).toBe(0)
    expect(now.money).toBe(START_MONEY + LEGACY_MONEY)
    expect(countOf(now.inv, 'bandage')).toBeGreaterThan(0)
    const haven = def().pois.find((q) => q.key === 'haven')
    if (!haven) throw new Error('no haven')
    expect(Math.hypot(p.state.pos.x - haven.x, p.state.pos.z - haven.z)).toBeLessThan(40)

    // The account remembers them; the world keeps them at Haven, standing about to talk to.
    expect(evacAccount(game.saves.account('acc-a')).retired).toEqual([name])
    const walkers = director.info().walkers ?? []
    const them = walkers.find((w) => w.who === name)
    expect(them).toBeDefined()
    expect(Math.hypot((them?.x ?? 0) - haven.x, (them?.z ?? 0) - haven.z)).toBeLessThan(30)
    game.step()
    await game.saves.flush()
    expect(game.saves.world.retired?.map((r) => r.name)).toEqual([name])
    const stored = (await store.get('account:acc-a')) as Record<string, unknown>
    expect(evacAccount(stored).retired).toEqual([name])
  }, 120000)

  test('the bonus follows the account to its next characters, and only that account', async () => {
    const store = new MemoryStore()
    await store.put('account:acc-b', { evac: { retired: ['Old Joe', 'May'] } })
    const { join, sv } = await server(store)
    const b = await join('Bea', 'acc-b')
    expect(sv(b).self.money).toBe(START_MONEY + 2 * LEGACY_MONEY)
    expect(countOf(sv(b).self.inv, 'painkillers')).toBe(1)
    const c = await join('Cal', 'acc-c')
    expect(sv(c).self.money).toBe(START_MONEY)
  }, 60000)

  test('the retired are loaded with the world and only the latest few stand about', async () => {
    const { director } = await server()
    const many = Array.from({ length: RETIRED_SHOWN + 3 }, (_, i) => ({ name: `R${i}`, day: i }))
    director.evac.restore(many)
    const shown = director.evac.walkers()
    expect(shown.length).toBe(RETIRED_SHOWN)
    expect(shown.at(-1)?.who).toBe(`R${RETIRED_SHOWN + 2}`)
  })
})

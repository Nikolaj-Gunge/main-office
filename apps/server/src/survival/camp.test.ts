import { beforeAll, describe, expect, test } from 'bun:test'
import {
  campStock,
  DAWN,
  DONATION,
  DONATION_BOX_KEY,
  DUSK,
  dawnsBetween,
  freshJournal,
  HAVEN_FIRE,
  healPrice,
  ITEMS,
  initPhysics,
  LEAVE_ORDER,
  loadMap,
  MORALE,
  MORALE_BOARD_KEY,
  MORALE_START,
  moraleTier,
  NIGHTFALL,
  nextToLeave,
  priceFactor,
  RED_NIGHT_EVERY,
  RED_WAVES,
  readCamp,
  redPhase,
  type Stack,
  type SurvivalDef,
  type SurvivalSelf,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import { Camp } from './camp.ts'
import type { Person } from './story.ts'

beforeAll(async () => {
  await initPhysics()
})

let deadwood: SurvivalDef | null = null
const def = () => {
  deadwood ??= loadMap('deadwood').survival ?? null
  if (!deadwood) throw new Error('no survival map')
  return deadwood
}
const havenOf = () => {
  const h = def().pois.find((p) => p.key === 'haven')
  if (!h) throw new Error('no haven')
  return h
}

describe('the Red Night calendar', () => {
  test('the eve, the day, dusk and the night', () => {
    expect(redPhase(5, 7, 0.6)).toBeNull()
    expect(redPhase(6, 7, 0.6)).toBe('eve')
    expect(redPhase(7, 7, 0.6)).toBe('eve')
    expect(redPhase(7, 7, DUSK + 0.01)).toBe('dusk')
    expect(redPhase(7, 7, NIGHTFALL + 0.01)).toBe('night')
    // After midnight the night still belongs to the day before.
    expect(redPhase(7, 7, 0.2)).toBe('night')
    expect(redPhase(8, 7, 0.2)).toBeNull()
  })

  test('days are counted dawn to dawn on a clock that only goes forward', () => {
    expect(dawnsBetween(0.05, 0.3)).toBe(0)
    expect(dawnsBetween(0.05, DAWN + 0.01)).toBe(1)
    expect(dawnsBetween(0.9, 1.05)).toBe(0)
    expect(dawnsBetween(0.9, 3 + DAWN)).toBe(3)
  })

  test('a camp record reads defensively', () => {
    const fresh = readCamp(undefined)
    expect(fresh.nextRed).toBe(RED_NIGHT_EVERY)
    expect(fresh.morale).toBe(MORALE_START)
    const odd = readCamp({
      day: 3,
      morale: 400,
      gone: [{ name: 'Ivy', why: 'left' }, 7],
      graves: 'x',
    })
    expect(odd.morale).toBe(100)
    expect(odd.gone.map((g) => g.name)).toEqual(['Ivy'])
    expect(odd.graves).toEqual([])
  })
})

describe('morale', () => {
  test('tiers set prices, Lena’s fee and what Gus stocks', () => {
    expect(moraleTier(10)).toBe('low')
    expect(moraleTier(50)).toBe('steady')
    expect(moraleTier(80)).toBe('high')
    expect(priceFactor(80)).toBeLessThan(1)
    expect(priceFactor(10)).toBeGreaterThan(1)
    expect(healPrice(80)).toBeLessThan(healPrice(50))
    expect(healPrice(10)).toBeGreaterThan(healPrice(50))
    expect(campStock(50).map(([i]) => i)).toEqual(['shovel'])
    expect(campStock(90).length).toBeGreaterThan(1)
    for (const [item] of campStock(90)) expect(ITEMS[item]).toBeDefined()
  })

  test('who leaves comes in order and is never the same twice', () => {
    expect(nextToLeave([])).toBe(LEAVE_ORDER[0] ?? null)
    expect(nextToLeave([LEAVE_ORDER[0] ?? ''])).toBe(LEAVE_ORDER[1] ?? null)
    expect(nextToLeave([...LEAVE_ORDER])).toBeNull()
  })
})

// --- The camp, on a pretend world ------------------------------------------------------------

interface Fake {
  camp: Camp
  people: Person[]
  zeds: ServerPlayer[]
  notices: string[]
  /** The world clock in days; the day's time follows from it. */
  clock: { days: number; now: number }
  busy: boolean
  step(seconds?: number): void
}

const fakePlayer = (id: number, pos = { x: 0, y: 0, z: 0 }): ServerPlayer =>
  ({
    id,
    name: `P${id}`,
    account: `acct${id}`,
    health: 100,
    maxHealth: 100,
    state: { alive: true, pos: { ...pos }, crouched: false, yaw: 0 },
  }) as unknown as ServerPlayer

const fakeSelf = (inv: Stack[] = []): SurvivalSelf =>
  ({
    inv: inv.map((s) => ({ ...s, c: 0, x: 0, y: 0 })),
    money: 100,
    journal: freshJournal(),
  }) as unknown as SurvivalSelf

function fake(people: Person[] = []): Fake {
  const notices: string[] = []
  const zeds: ServerPlayer[] = []
  const clock = { days: 0.5, now: 0 }
  const f: Fake = {
    people,
    zeds,
    notices,
    clock,
    busy: false,
    camp: null as unknown as Camp,
    step(seconds = 1) {
      for (let i = 0; i < seconds; i++) {
        clock.now += 1
        clock.days += 1 / (32 * 60)
        f.camp.tick()
      }
    },
  }
  f.camp = new Camp({
    def,
    now: () => clock.now,
    random: () => 0.4,
    people: () => f.people,
    count: (p, item) => p.self.inv.filter((s) => s.item === item).reduce((n, s) => n + s.n, 0),
    take: () => {},
    give: (p, item, n) => {
      p.self.inv.push({ item, n, c: 0, x: 0, y: 0 } as unknown as SurvivalSelf['inv'][number])
    },
    touch: () => {},
    notice: (_player, _kind, text) => {
      notices.push(text)
    },
    dialog: (_player, d) => {
      if (d) notices.push(d.text)
    },
    broadcast: () => {},
    spawnZed: (at) => {
      const z = fakePlayer(1000 + zeds.length, at)
      zeds.push(z)
      return z
    },
    steer: () => {},
    unsiege: () => {},
    days: () => clock.days,
    time: () => clock.days % 1,
    busy: () => f.busy,
    owner: (p) => p.player.account ?? '',
    takeLast: (p) => {
      const st = p.self.inv.pop()
      return st ? { item: st.item, n: st.n } : null
    },
    crouched: (p) => p.player.state.crouched,
  })
  return f
}

/** Moves the fake clock to clock time `t` on the current world day (or the next, if past it). */
function at(f: Fake, t: number): void {
  const day = Math.floor(f.clock.days - DAWN) + DAWN
  let target = Math.floor(day) + t
  if (target <= f.clock.days) target += 1
  f.clock.days = target
  f.camp.tick()
}

/** Runs the world on to the start of the Red Night (nightfall on its day). */
function toRedNight(f: Fake): void {
  f.camp.tick()
  f.camp.redTonight()
  at(f, NIGHTFALL + 0.001)
}

const haven = () => havenOf()
const defender = (id: number) => {
  const h = haven()
  return { player: fakePlayer(id, { x: h.x, y: h.y, z: h.z - 10 }), self: fakeSelf() }
}

describe('Red Night', () => {
  test('warned the day before, a horn at dusk, waves at night', () => {
    const f = fake([defender(1)])
    f.camp.tick()
    const s = f.camp.state
    // Run the days up to the eve.
    while (s.day < s.nextRed - 1) at(f, DAWN + 0.05)
    expect(f.notices.some((n) => n.includes('Tomorrow night'))).toBe(true)
    at(f, DAWN + 0.05)
    expect(s.day).toBe(s.nextRed)
    at(f, DUSK + 0.01)
    expect(f.notices.some((n) => n.includes('horn'))).toBe(true)
    expect(f.camp.shared().red).toBe('dusk')
    expect(f.camp.noSleep()).toBe(true)
    at(f, NIGHTFALL + 0.001)
    expect(f.camp.fighting).toBe(true)
    f.step(6)
    expect(f.zeds.length).toBeGreaterThan(0)
    expect(f.camp.siege()?.poi).toBe('haven')
    expect(f.camp.besieged(haven())).toBe(true)
  })

  test('held: a win on the banner, Haven grows, morale up, the next one a week on', () => {
    const f = fake([defender(1)])
    toRedNight(f)
    const before = f.camp.morale
    // Every wave comes and every one of them is put down.
    for (let i = 0; i < RED_WAVES * 80 && f.camp.fighting; i++) {
      for (const z of f.zeds) z.state.alive = false
      f.step()
    }
    const s = f.camp.state
    expect(f.camp.fighting).toBe(false)
    expect(s.wins).toBe(1)
    expect(s.level).toBe(1)
    expect(f.camp.morale).toBeGreaterThan(before)
    expect(s.nextRed).toBe(s.day + RED_NIGHT_EVERY)
    expect(f.people[0]?.self.money).toBe(140)
  })

  test('holding till dawn counts too', () => {
    const f = fake([defender(1)])
    toRedNight(f)
    at(f, DAWN + 0.01)
    expect(f.camp.state.wins).toBe(1)
  })

  test('lost when they reach the fire: Haven shrinks and people are taken', () => {
    const f = fake([defender(1)])
    toRedNight(f)
    f.step(6)
    const h = haven()
    for (const z of f.zeds) z.state.pos = { x: h.x + HAVEN_FIRE[0], y: h.y, z: h.z + HAVEN_FIRE[1] }
    f.step(3)
    const s = f.camp.state
    expect(f.camp.fighting).toBe(false)
    expect(s.losses).toBe(1)
    expect(s.shut).toBe(true)
    expect(s.gone.filter((g) => g.why === 'taken').length).toBe(2)
    expect(f.camp.morale).toBeLessThan(MORALE_START)
    expect(f.camp.shared().gone.length).toBe(2)
    // They lie by the fire, to be buried by name.
    expect(f.camp.shared().remains?.map((r) => r.name)).toEqual(s.gone.map((g) => g.name))
  })

  test('a win after a loss opens the boarded stall again before anything else', () => {
    const f = fake([defender(1)])
    f.camp.state.shut = true
    f.camp.state.gone.push({ name: 'Ivy', why: 'left', day: 0 })
    f.camp.settle(true)
    expect(f.camp.state.shut).toBe(false)
    expect(f.camp.state.gone.length).toBe(1)
    f.camp.settle(true)
    // Then somebody who walked out comes back.
    expect(f.camp.state.gone.length).toBe(0)
  })

  test('nobody online: the camp holds on its spirit alone', () => {
    const f = fake([])
    f.camp.state.morale = 80
    toRedNight(f)
    expect(f.camp.state.wins).toBe(1)
    const g = fake([])
    g.camp.state.morale = 10
    toRedNight(g)
    expect(g.camp.state.losses).toBe(1)
  })

  test("the story's own siege at Haven puts it off a day", () => {
    const f = fake([defender(1)])
    f.busy = true
    toRedNight(f)
    expect(f.camp.fighting).toBe(false)
    expect(f.camp.state.nextRed).toBe(f.camp.state.day + 1)
  })

  test('remembered across a save', () => {
    const f = fake()
    f.camp.state.wins = 3
    f.camp.state.morale = 77
    const g = fake()
    g.camp.restore(JSON.parse(JSON.stringify(f.camp.save())))
    expect(g.camp.state.wins).toBe(3)
    expect(g.camp.morale).toBe(77)
  })
})

describe('morale in play', () => {
  test('jobs, donations and graves raise it; deaths at Haven and the days lower it', () => {
    const p = defender(1)
    const f = fake([p])
    const m0 = f.camp.morale
    f.camp.noted('quest')
    expect(f.camp.morale).toBe(m0 + MORALE.quest)
    f.camp.use(p, DONATION_BOX_KEY)
    expect(p.self.money).toBe(100 - DONATION)
    expect(f.camp.morale).toBe(m0 + MORALE.quest + MORALE.donate)
    const h = haven()
    const m1 = f.camp.morale
    f.camp.died('Sam', { x: h.x, y: h.y, z: h.z })
    expect(f.camp.morale).toBe(m1 + MORALE.death)
    // Far out in the woods it doesn't weigh on the camp.
    f.camp.died('Ann', { x: h.x + 900, y: h.y, z: h.z + 900 })
    expect(f.camp.morale).toBe(m1 + MORALE.death)
    f.camp.tick()
    const m2 = f.camp.morale
    at(f, DAWN + 0.05)
    expect(f.camp.morale).toBe(m2 + MORALE.day)
  })

  test('low morale: somebody walks out each dawn, by name', () => {
    const f = fake()
    f.camp.tick()
    f.camp.state.morale = 10
    at(f, DAWN + 0.05)
    at(f, DAWN + 0.05)
    expect(f.camp.state.gone.map((g) => g.name)).toEqual(LEAVE_ORDER.slice(0, 2))
    expect(f.camp.state.gone.every((g) => g.why === 'left')).toBe(true)
  })

  test('the board tells it', () => {
    const p = defender(1)
    const f = fake([p])
    f.camp.use(p, MORALE_BOARD_KEY)
    const text = f.notices.at(-1) ?? ''
    expect(text).toContain('Spirits')
    expect(text).toContain(`Red Night in ${RED_NIGHT_EVERY} days`)
  })

  test('the price of things follows morale', () => {
    const f = fake()
    f.camp.state.morale = 90
    expect(f.camp.terms().price).toBeLessThan(1)
    expect(f.camp.terms().stock.length).toBeGreaterThan(1)
    f.camp.state.morale = 5
    expect(f.camp.terms().price).toBeGreaterThan(1)
  })
})

describe('graves', () => {
  test('a shovel, crouched by the body: a grave with the name, and morale up', () => {
    const p = defender(1)
    p.self = fakeSelf([{ item: 'shovel', n: 1 }])
    const f = fake([p])
    const pos = p.player.state.pos
    f.camp.died('Mara Kell', { x: pos.x + 1, y: pos.y, z: pos.z })
    // Standing, or without a shovel, it's nothing to do with the camp.
    expect(f.camp.dig(p)).toBe(false)
    p.player.state.crouched = true
    const m = f.camp.morale
    expect(f.camp.dig(p)).toBe(true)
    const graves = f.camp.shared().graves
    expect(graves.map((g) => g.name)).toEqual(['Mara Kell'])
    expect(f.camp.morale).toBe(m + MORALE.grave)
    expect(f.camp.shared().remains).toBeUndefined()
  })

  test('a stash buried with them comes back only to whoever dug the grave', () => {
    const p = defender(1)
    p.self = fakeSelf([
      { item: 'shovel', n: 1 },
      { item: 'ring', n: 1 },
    ])
    p.player.state.crouched = true
    const f = fake([p])
    const pos = p.player.state.pos
    f.camp.downed('', { x: pos.x, y: pos.y, z: pos.z + 1 })
    f.camp.dig(p)
    expect(f.camp.shared().graves[0]?.name).toBe('Unknown')
    // Again at the grave: the ring goes in with them.
    f.camp.dig(p)
    expect(p.self.inv.some((s) => s.item === 'ring')).toBe(false)
    expect(f.camp.shared().graves[0]?.stash).toBe(true)
    // Somebody else can't have it.
    const q = defender(2)
    q.self = fakeSelf([{ item: 'shovel', n: 1 }])
    q.player.state.crouched = true
    f.people.push(q)
    f.camp.dig(q)
    expect(q.self.inv.some((s) => s.item === 'ring')).toBe(false)
    // The owner digs it back up.
    f.camp.dig(p)
    expect(p.self.inv.some((s) => s.item === 'ring')).toBe(true)
    expect(f.camp.shared().graves[0]?.stash).toBeUndefined()
    // And the grave outlives a save.
    const g = fake()
    g.camp.restore(JSON.parse(JSON.stringify(f.camp.save())))
    expect(g.camp.shared().graves.length).toBe(1)
  })

  test("Haven's board and box are things to use, and the shovel is an item", () => {
    const keys = def().interactables.map((i) => i.key)
    expect(keys).toContain(MORALE_BOARD_KEY)
    expect(keys).toContain(DONATION_BOX_KEY)
    expect(ITEMS.shovel?.kind).toBe('tool')
  })
})

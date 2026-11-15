import { beforeAll, describe, expect, test } from 'bun:test'
import {
  DAWN,
  freshJournal,
  GREENHOUSE_PRICE,
  initPhysics,
  loadMap,
  MORALE,
  MORALE_START,
  NIGHTFALL,
  PROJECT_BOARD_KEY,
  PROJECT_MORALE,
  PROJECTS,
  type ProjectId,
  plaqueNames,
  priceFactor,
  projectProgress,
  readCamp,
  readProjects,
  type Stack,
  type SurvivalDef,
  type SurvivalSelf,
  sharedProjects,
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

const person = (id: number, name: string, inv: Stack[] = []): Person => {
  const h = def().pois.find((p) => p.key === 'haven')
  return {
    player: {
      id,
      name,
      account: `acct${id}`,
      state: { alive: true, pos: { x: h?.x ?? 0, y: 0, z: (h?.z ?? 0) - 10 }, crouched: false },
    } as unknown as ServerPlayer,
    self: {
      inv: inv.map((s) => ({ ...s, c: 0, x: 0, y: 0 })),
      money: 100,
      journal: freshJournal(),
    } as unknown as SurvivalSelf,
  }
}

const count = (p: Person, item: string) =>
  p.self.inv.filter((s) => s.item === item).reduce((n, s) => n + s.n, 0)

function fake(people: Person[]) {
  const notices: string[] = []
  const dialogs: { text: string; options: string[] }[] = []
  const clock = { days: 0.5, now: 0 }
  const camp = new Camp({
    def,
    now: () => clock.now,
    random: () => 0.4,
    people: () => people,
    count,
    take: (p, item, n) => {
      let left = n
      for (const s of p.self.inv) {
        if (s.item !== item || left <= 0) continue
        const k = Math.min(s.n, left)
        s.n -= k
        left -= k
      }
      p.self.inv = p.self.inv.filter((s) => s.n > 0)
    },
    give: () => {},
    touch: () => {},
    notice: (_player, _kind, text) => {
      notices.push(text)
    },
    dialog: (_player, d) => {
      if (d) dialogs.push({ text: d.text, options: d.options.map((o) => o.id) })
    },
    broadcast: () => {},
    spawnZed: (at) =>
      ({ id: 900, state: { alive: true, pos: { ...at } } }) as unknown as ServerPlayer,
    steer: () => {},
    unsiege: () => {},
    days: () => clock.days,
    time: () => clock.days % 1,
    busy: () => false,
    owner: (p) => p.player.account ?? '',
    takeLast: () => null,
    crouched: () => false,
  })
  return { camp, notices, dialogs, clock }
}

/** Everything a project needs, in one person's pack. */
const kitFor = (id: ProjectId): Stack[] =>
  Object.entries(PROJECTS.find((p) => p.id === id)?.needs ?? {}).map(([item, n]) => ({ item, n }))

describe('project records', () => {
  test('read defensively: unknown projects, items and junk are dropped, gifts capped', () => {
    const r = readProjects({
      well: { given: { scrap: 999, planks: 'x', gold: 4 }, donors: { Ada: 5, Bo: -1 }, done: 3 },
      moonbase: { given: { scrap: 1 } },
      wall: 7,
    })
    expect(Object.keys(r)).toEqual(['well'])
    expect(r.well?.given).toEqual({ scrap: 10, planks: 0, ducttape: 0 })
    expect(r.well?.donors).toEqual({ Ada: 5 })
    expect(r.well?.done).toBe(3)
    expect(readProjects('nope')).toEqual({})
  })

  test('the plaque: most generous first, ties by name, ten at most', () => {
    const donors: Record<string, number> = { Cy: 3, Ada: 3, Bo: 9 }
    for (let i = 0; i < 12; i++) donors[`X${i}`] = 1
    expect(plaqueNames({ given: {}, donors }).slice(0, 3)).toEqual(['Bo', 'Ada', 'Cy'])
    expect(plaqueNames({ given: {}, donors })).toHaveLength(10)
  })

  test('everybody sees every project, in order, with names only once built', () => {
    const shared = sharedProjects({
      well: { given: { scrap: 10, planks: 8, ducttape: 4 }, donors: { Ada: 22 }, done: 2 },
      watchtower: { given: { planks: 12 }, donors: { Bo: 12 } },
    })
    expect(shared.map((p) => p.id)).toEqual(PROJECTS.map((p) => p.id))
    const tower = shared.find((p) => p.id === 'watchtower')
    expect(tower?.names).toBeUndefined()
    expect(tower?.given).toEqual([12, 0, 0])
    expect(shared.find((p) => p.id === 'well')?.names).toEqual(['Ada'])
    const towerDef = PROJECTS.find((p) => p.id === 'watchtower')
    if (towerDef && tower) expect(projectProgress(towerDef, tower.given)).toBeCloseTo(12 / 35)
  })
})

describe('building together at Haven', () => {
  test('the board lists the projects and offers what you can give', () => {
    const ada = person(1, 'Ada', [{ item: 'planks', n: 5 }])
    const f = fake([ada])
    f.camp.use(ada, PROJECT_BOARD_KEY)
    const d = f.dialogs.at(-1)
    expect(d?.text).toContain('The North Watchtower')
    // Planks go into the watchtower, the well, the wall and the greenhouse.
    expect(d?.options).toContain('give:watchtower')
    expect(d?.options).toContain('give:well')
    expect(d?.options.at(-1)).toBe('bye')
  })

  test('gifts are taken, counted, capped at what is still needed, and named', () => {
    const ada = person(1, 'Ada', [{ item: 'planks', n: 30 }])
    const bo = person(2, 'Bo', [{ item: 'planks', n: 10 }])
    const f = fake([ada, bo])
    expect(f.camp.projects.give(ada, 'watchtower')).toBe(24)
    expect(count(ada, 'planks')).toBe(6)
    // Nothing more of planks needed: Bo's stay with Bo.
    expect(f.camp.projects.give(bo, 'watchtower')).toBe(0)
    expect(count(bo, 'planks')).toBe(10)
    const tower = f.camp.projects.shared().find((p) => p.id === 'watchtower')
    expect(tower?.given).toEqual([24, 0, 0])
    expect(f.camp.projects.has('watchtower')).toBe(false)
  })

  test('the last of it finishes the project: morale up, everyone told, plaque names', () => {
    const ada = person(1, 'Ada', [{ item: 'planks', n: 8 }])
    const bo = person(2, 'Bo', [
      { item: 'scrap', n: 10 },
      { item: 'ducttape', n: 4 },
    ])
    const f = fake([ada, bo])
    const before = f.camp.morale
    f.camp.projects.give(ada, 'well')
    expect(f.camp.projects.has('well')).toBe(false)
    f.camp.projects.give(bo, 'well')
    expect(f.camp.projects.has('well')).toBe(true)
    expect(f.camp.morale).toBe(before + PROJECT_MORALE)
    expect(f.notices.some((n) => n.includes('The Well is finished') && n.includes('Bo, Ada'))).toBe(
      true,
    )
    const well = f.camp.shared().projects?.find((p) => p.id === 'well')
    expect(well?.done).toBe(0)
    expect(well?.names).toEqual(['Bo', 'Ada'])
    // Built is built: nothing more goes in.
    const cy = person(3, 'Cy', [{ item: 'scrap', n: 5 }])
    expect(f.camp.projects.give(cy, 'well')).toBe(0)
  })

  test('answers on the board give and show the board again; anything else closes it', () => {
    const ada = person(1, 'Ada', kitFor('greenhouse'))
    const f = fake([ada])
    f.camp.projects.choose(ada, 'give:greenhouse')
    expect(f.camp.projects.has('greenhouse')).toBe(true)
    expect(f.dialogs.at(-1)?.text).toContain('The Greenhouse: BUILT. Ada.')
    const n = f.dialogs.length
    f.camp.projects.choose(ada, 'bye')
    expect(f.dialogs.length).toBe(n)
  })

  test('kept in the world save with the camp, and back again', () => {
    const ada = person(1, 'Ada', [...kitFor('wall'), { item: 'planks', n: 3 }])
    const f = fake([ada])
    f.camp.projects.give(ada, 'wall')
    f.camp.projects.give(ada, 'watchtower')
    const saved = JSON.parse(JSON.stringify(f.camp.save()))
    expect(readCamp(saved).projects?.wall?.done).toBe(0)
    const g = fake([])
    g.camp.restore(saved)
    expect(g.camp.projects.has('wall')).toBe(true)
    expect(g.camp.projects.shared().find((p) => p.id === 'watchtower')?.given[0]).toBe(3)
    // Older saves have none.
    g.camp.restore({ day: 4 })
    expect(g.camp.projects.has('wall')).toBe(false)
  })
})

describe('what the projects do for Haven', () => {
  test('the greenhouse takes a little off the traders’ prices', () => {
    const ada = person(1, 'Ada', kitFor('greenhouse'))
    const f = fake([ada])
    const before = f.camp.terms().price
    f.camp.projects.give(ada, 'greenhouse')
    expect(f.camp.terms().price).toBeCloseTo(priceFactor(f.camp.morale) * GREENHOUSE_PRICE)
    expect(f.camp.terms().price).toBeLessThan(before)
  })

  test('the well makes each dawn cost Haven less', () => {
    const plain = fake([])
    const ada = person(1, 'Ada', kitFor('well'))
    const well = fake([ada])
    well.camp.projects.give(ada, 'well')
    for (const f of [plain, well]) {
      f.camp.tick()
      f.clock.days = Math.floor(f.clock.days) + 1 + DAWN + 0.01
      f.camp.tick()
    }
    expect(plain.camp.morale).toBe(MORALE_START + MORALE.day)
    expect(well.camp.morale).toBe(MORALE_START + PROJECT_MORALE + MORALE.day + 1)
  })

  test('a Red Night still comes and is fought with everything built', () => {
    const ada = person(
      1,
      'Ada',
      PROJECTS.flatMap((p) => kitFor(p.id)),
    )
    const f = fake([ada])
    for (const p of PROJECTS) f.camp.projects.give(ada, p.id)
    for (const p of PROJECTS) expect(f.camp.projects.has(p.id)).toBe(true)
    f.camp.tick()
    f.camp.redTonight()
    f.clock.days = Math.floor(f.clock.days) + NIGHTFALL + 0.001
    if (f.clock.days < 0.5) f.clock.days += 1
    f.camp.tick()
    expect(f.camp.phase).toBe('night')
    for (let i = 0; i < 10; i++) {
      f.clock.now += 1
      f.camp.tick()
    }
    expect(f.camp.siege()?.poi).toBe('haven')
  })
})

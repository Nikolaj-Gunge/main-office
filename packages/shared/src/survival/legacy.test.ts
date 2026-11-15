import { describe, expect, test } from 'bun:test'
import { packAppearance } from '../appearance.ts'
import { DAY_SECONDS } from './daytime.ts'
import {
  addObituary,
  bumpLife,
  cleanLegacy,
  cleanWall,
  earnedTrait,
  freshLife,
  freshWall,
  type LifeStats,
  leaveFlowers,
  MAX_LIVES,
  type Obituary,
  type PastLife,
  pileSize,
  portraitColours,
  recordLife,
  survivedText,
  TRAIT_LIST,
  traitFactor,
  WALL_NAMES,
} from './legacy.ts'

const life = (over: Partial<LifeStats>): LifeStats => ({ ...freshLife(), ...over })
const past = (name: string, trait: PastLife['trait'] = null): PastLife => ({
  name,
  past: '',
  alive: 100,
  kills: 1,
  cause: 'Died alone',
  at: 0,
  look: 0,
  trait,
})
const obit = (name: string): Obituary => ({
  name,
  alive: 1,
  kills: 0,
  cause: 'Turned',
  look: 0,
  at: 0,
  flowers: 0,
})

describe('legacy traits', () => {
  test('a life earns the trait it went furthest past the need for; nothing if none', () => {
    expect(earnedTrait(undefined)).toBeNull()
    expect(earnedTrait(freshLife())).toBeNull()
    expect(earnedTrait(life({ kills: 39 }))).toBeNull()
    expect(earnedTrait(life({ kills: 40 }))).toBe('steady')
    expect(earnedTrait(life({ nights: 5 }))).toBe('nightowl')
    expect(earnedTrait(life({ walked: 10_000 }))).toBe('longlegs')
    expect(earnedTrait(life({ crafted: 20 }))).toBe('handy')
    expect(earnedTrait(life({ meals: 30 }))).toBe('stomach')
    expect(earnedTrait(life({ patched: 10 }))).toBe('medic')
    // Twice the kills needed beats just enough nights.
    expect(earnedTrait(life({ kills: 80, nights: 5 }))).toBe('steady')
    expect(earnedTrait(life({ kills: 40, nights: 12 }))).toBe('nightowl')
    // A tie: the first in TRAITS.
    expect(earnedTrait(life({ kills: 40, nights: 5 }))).toBe('steady')
  })

  test('every effect is small, and only for its own trait', () => {
    for (const t of TRAIT_LIST) {
      expect(Math.abs(1 - t.factor)).toBeGreaterThanOrEqual(0.05)
      expect(Math.abs(1 - t.factor)).toBeLessThanOrEqual(0.1 + 1e-9)
      expect(traitFactor(t.id, t.effect)).toBe(t.factor)
    }
    expect(traitFactor('steady', 'craft')).toBe(1)
    expect(traitFactor(null, 'sway')).toBe(1)
    expect(traitFactor('nonsense', 'sway')).toBe(1)
  })

  test('counting a life starts it at nothing', () => {
    const self: { life?: LifeStats } = {}
    bumpLife(self, 'kills')
    bumpLife(self, 'walked', 2.5)
    expect(self.life).toEqual(life({ kills: 1, walked: 2.5 }))
  })
})

describe('the journal of past lives', () => {
  test('newest first; the newest trait leads and none repeat; old lives are forgotten', () => {
    let legacy = cleanLegacy(undefined)
    legacy = recordLife(legacy, past('A', 'steady'))
    legacy = recordLife(legacy, past('B'))
    legacy = recordLife(legacy, past('C', 'handy'))
    legacy = recordLife(legacy, past('D', 'steady'))
    expect(legacy.lives.map((l) => l.name)).toEqual(['D', 'C', 'B', 'A'])
    expect(legacy.traits).toEqual(['steady', 'handy'])
    for (let i = 0; i < MAX_LIVES; i++) legacy = recordLife(legacy, past(`x${i}`))
    expect(legacy.lives).toHaveLength(MAX_LIVES)
  })

  test('junk in the save is left out', () => {
    expect(
      cleanLegacy({ lives: [null, 3, past('A')], traits: ['steady', 'fly', 'steady'] }),
    ).toEqual({ lives: [past('A')], traits: ['steady'] })
    expect(cleanLegacy('junk')).toEqual({ lives: [], traits: [] })
  })
})

describe('the obituary wall', () => {
  test('newest name on top, only so many; flowers go to the newest', () => {
    let wall = freshWall()
    wall = leaveFlowers(wall)
    expect(wall).toEqual({ dead: [], flowers: 1 })
    for (let i = 0; i < WALL_NAMES + 3; i++) wall = addObituary(wall, obit(`n${i}`))
    expect(wall.dead).toHaveLength(WALL_NAMES)
    expect(wall.dead[0]?.name).toBe(`n${WALL_NAMES + 2}`)
    wall = leaveFlowers(leaveFlowers(wall))
    expect(wall.flowers).toBe(3)
    expect(wall.dead[0]?.flowers).toBe(2)
    expect(wall.dead[1]?.flowers).toBe(0)
  })

  test('a saved wall is made safe', () => {
    expect(cleanWall(undefined)).toEqual(freshWall())
    expect(cleanWall({ dead: [obit('a'), 7], flowers: -3 })).toEqual({
      dead: [obit('a')],
      flowers: 0,
    })
  })

  test('the flower pile grows, ever slower, and stops', () => {
    expect(pileSize(0)).toBe(0)
    expect(pileSize(1)).toBeGreaterThan(0)
    expect(pileSize(10)).toBeGreaterThan(pileSize(1))
    expect(pileSize(100_000)).toBe(48)
  })

  test('how long somebody lasted, and their portrait colours', () => {
    expect(survivedText(60)).toBe('less than an hour')
    expect(survivedText(DAY_SECONDS / 24)).toBe('1 hour')
    expect(survivedText(DAY_SECONDS / 4)).toBe('6 hours')
    expect(survivedText(DAY_SECONDS)).toBe('1 day')
    expect(survivedText(DAY_SECONDS * 3.7)).toBe('3 days')
    const look = packAppearance({ body: 0, skin: 0, hair: 2, hairColor: 0, eyes: 0, beard: 0 })
    expect(portraitColours(look)).toEqual({ skin: '#f6d3b8', hair: '#161616' })
    const bald = packAppearance({ body: 0, skin: 3, hair: 0, hairColor: 0, eyes: 0, beard: 0 })
    expect(portraitColours(bald).hair).toBe(portraitColours(bald).skin)
  })
})

import { describe, expect, test } from 'bun:test'
import {
  type Bag,
  CONTAINERS,
  cellsUsed,
  cloneBag,
  findSpot,
  fitsAt,
  footprint,
  GEAR,
  give,
  gridOf,
  ITEM_LIST,
  isItemDest,
  isItemRef,
  loosen,
  maxStack,
  pocketsOf,
  regive,
  roomFor,
  STARTING_POCKETS,
  sizeOf,
  slotFor,
  stackAt,
} from '../index.ts'

const fresh = (): Bag => ({ inv: [], wear: {}, pack: null })

describe('grid: sizes', () => {
  test('every item has a sensible size; long guns are long, ammo is one cell', () => {
    for (const def of ITEM_LIST) {
      const [w, h] = sizeOf(def.id)
      expect(w).toBeGreaterThanOrEqual(1)
      expect(h).toBeGreaterThanOrEqual(1)
      // Nothing is too big for the biggest pack.
      expect(w).toBeLessThanOrEqual(8)
      expect(h).toBeLessThanOrEqual(6)
      expect(maxStack(def.id)).toBeGreaterThanOrEqual(1)
    }
    expect(sizeOf('ammo9')).toEqual([1, 1])
    expect(sizeOf('beans')).toEqual([1, 2])
    expect(sizeOf('glock')).toEqual([2, 2])
    expect(sizeOf('m4')[0]).toBeGreaterThanOrEqual(6)
    expect(maxStack('ammo9')).toBeGreaterThan(1)
    expect(maxStack('glock')).toBe(1)
    expect(footprint('beans', 1)).toEqual([2, 1])
  })

  test('clothes and packs give pockets; hats and shoes do not', () => {
    for (const [id, g] of Object.entries(GEAR)) {
      if (g.slot === 'head' || g.slot === 'feet') expect(pocketsOf(id)).toBeNull()
      else expect(pocketsOf(id)).not.toBeNull()
    }
    for (const id of ['pack_school', 'pack_hiking', 'pack_military']) {
      const [w, h] = pocketsOf(id) ?? [0, 0]
      expect(w * h).toBeGreaterThan(15)
    }
    expect(slotFor('glock')).toBe('sidearm')
    expect(slotFor('m4')).toBe('primary')
    expect(slotFor('knife')).toBe('melee')
    expect(slotFor('jeans')).toBe('legs')
    expect(slotFor('pack_school')).toBe('pack')
    expect(slotFor('beans')).toBeNull()
  })
})

describe('grid: what you can carry comes from what you wear', () => {
  test('a new character has the tank top and joggers pockets, and no pack', () => {
    const bag = fresh()
    expect(gridOf(bag, 'body')).toEqual(STARTING_POCKETS.body)
    expect(gridOf(bag, 'legs')).toEqual(STARTING_POCKETS.legs)
    expect(gridOf(bag, 'pack')).toBeNull()
    expect(cellsUsed(bag, 'body')).toEqual({ used: 0, total: 2 })
    // A rifle doesn't fit anywhere; a jacket and a rucksack change that.
    expect(roomFor(bag, 'm4')).toBe(0)
    bag.wear.body = 'jacket'
    expect(cellsUsed(bag, 'body').total).toBe(12)
    bag.pack = 'pack_hiking'
    expect(roomFor(bag, 'm4')).toBeGreaterThanOrEqual(1)
  })

  test('cargo pants hold more than joggers', () => {
    const bag = fresh()
    const before = roomFor(bag, 'ammo9')
    bag.wear.legs = 'cargopants'
    expect(roomFor(bag, 'ammo9')).toBeGreaterThan(before)
  })
})

describe('grid: placing things', () => {
  test('fits inside, never overlaps, never outside', () => {
    const bag = fresh()
    bag.pack = 'pack_school' // 5 × 4
    bag.inv.push({ item: 'glock', n: 1, ammo: 0, c: 'pack', x: 0, y: 0 })
    expect(fitsAt(bag, 'pack', 0, 0, 1, 1)).toBe(false)
    expect(fitsAt(bag, 'pack', 1, 1, 1, 1)).toBe(false)
    expect(fitsAt(bag, 'pack', 2, 0, 2, 2)).toBe(true)
    expect(fitsAt(bag, 'pack', 4, 0, 2, 1)).toBe(false) // off the right edge
    expect(fitsAt(bag, 'pack', 0, 3, 1, 2)).toBe(false) // off the bottom
    expect(fitsAt(bag, 'pack', -1, 0, 1, 1)).toBe(false)
    expect(fitsAt(bag, 'pack', 0.5, 0, 1, 1)).toBe(false)
    // The stack being moved doesn't block itself.
    expect(fitsAt(bag, 'pack', 1, 0, 2, 2, bag.inv[0])).toBe(true)
    expect(stackAt(bag.inv, 'pack', 1, 1)?.item).toBe('glock')
    expect(stackAt(bag.inv, 'pack', 2, 1)).toBeUndefined()
  })

  test('turning something on its side lets it fit where it would not', () => {
    const bag = fresh()
    // The tank top's one pocket is 2 × 1: a water bottle (1 × 2) only goes in on its side.
    expect(fitsAt(bag, 'body', 0, 0, ...footprint('water'))).toBe(false)
    expect(fitsAt(bag, 'body', 0, 0, ...footprint('water', 1))).toBe(true)
    expect(findSpot(bag, 'water')).toEqual({ c: 'body', x: 0, y: 0, r: 1 })
  })

  test('give tops up stacks, starts new ones, and stops when full', () => {
    const bag = fresh()
    // 2 + 4 cells of pockets: 6 boxes of 50 rounds.
    expect(give(bag, 'ammo9', 1000)).toBe(300)
    expect(bag.inv.length).toBe(6)
    expect(roomFor(bag, 'ammo9')).toBe(0)
    bag.inv.splice(0, 1)
    const top = bag.inv[0]
    if (!top) throw new Error('no stack')
    top.n = 20
    expect(give(bag, 'ammo9', 40)).toBe(40)
    expect(top.n).toBe(50)
    // Weapons never stack, and keep what's loaded.
    const big = fresh()
    big.pack = 'pack_military'
    expect(give(big, 'glock', 2, 7)).toBe(2)
    expect(big.inv.map((s) => [s.n, s.ammo])).toEqual([
      [1, 7],
      [1, 7],
    ])
  })

  test('first fit goes pockets first, then the pack', () => {
    const bag = fresh()
    bag.pack = 'pack_school'
    give(bag, 'ammo9', 1)
    expect(bag.inv[0]?.c).toBe(CONTAINERS[0])
    give(bag, 'medkit', 1) // 2 × 2: the joggers
    expect(bag.inv[1]?.c).toBe('legs')
    give(bag, 'cereal', 1) // 2 × 3: only the pack
    expect(bag.inv[2]?.c).toBe('pack')
  })

  test('taking clothes off loosens what no longer fits, and it can go back elsewhere', () => {
    const bag = fresh()
    bag.wear.legs = 'cargopants' // 4 × 2
    give(bag, 'ammo9', 500) // fills the tank top and the cargo pants
    const before = bag.inv.length
    const trial = cloneBag(bag)
    delete trial.wear.legs // back to joggers: 2 × 2
    const loose = loosen(trial, 'legs')
    expect(loose.length).toBe(4)
    expect(trial.inv.length).toBe(before - 4)
    // Nowhere for them without a pack; with one they all go in.
    expect(regive(cloneBag(trial), loose).length).toBeGreaterThan(0)
    trial.pack = 'pack_school'
    expect(regive(trial, loose)).toEqual([])
    // The original was untouched.
    expect(bag.inv.length).toBe(before)
  })
})

describe('grid: what the client may send', () => {
  test('references and destinations are checked for shape', () => {
    expect(isItemRef({ c: 'pack', x: 1, y: 2 })).toBe(true)
    expect(isItemRef({ slot: 'primary' })).toBe(true)
    expect(isItemRef({ g: 12 })).toBe(true)
    expect(isItemRef({ c: 'hat', x: 1, y: 2 })).toBe(false)
    expect(isItemRef({ c: 'pack', x: 1.5, y: 2 })).toBe(false)
    expect(isItemRef({ slot: 'pocket' })).toBe(false)
    expect(isItemRef(null)).toBe(false)
    expect(isItemDest({ c: 'body', x: 0, y: 0, r: 1 })).toBe(true)
    expect(isItemDest({ c: 'body', x: 0, y: 0, r: 2 })).toBe(false)
    expect(isItemDest({ ground: true })).toBe(true)
    expect(isItemDest({ auto: true })).toBe(true)
    expect(isItemDest({ slot: 'feet' })).toBe(true)
    expect(isItemDest('auto')).toBe(false)
  })
})

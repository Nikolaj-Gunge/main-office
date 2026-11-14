import { describe, expect, test } from 'bun:test'
import { FEET_LOOKS, LEGS_LOOKS } from '../appearance.ts'
import {
  BODY_LOOKS,
  bodyLook,
  feetLook,
  GEAR,
  gearLooks,
  HEAD_LOOKS,
  headLook,
  legsLook,
  WEAR_SLOTS,
} from './gear.ts'
import { ITEMS } from './items.ts'
import { wornStats } from './protocol.ts'

describe('gear', () => {
  test('nothing worn is the starting outfit: tank top, joggers, barefoot (all look 0)', () => {
    expect(gearLooks([])).toBe(0)
  })

  test('packs head | body << 4 | legs << 8 | feet << 12 into a u16', () => {
    const gear = gearLooks(['helmet', 'policevest', 'policetrousers', 'militaryboots'])
    expect(gear).toBeLessThanOrEqual(0xffff)
    expect(headLook(gear)).toBe(HEAD_LOOKS.helmet)
    expect(bodyLook(gear)).toBe(BODY_LOOKS.police)
    expect(legsLook(gear)).toBe(LEGS_LOOKS.police)
    expect(feetLook(gear)).toBe(FEET_LOOKS.military)
    const shoes = gearLooks(['jeans', 'sneakers'])
    expect([headLook(shoes), bodyLook(shoes)]).toEqual([0, 0])
    expect(legsLook(shoes)).toBe(LEGS_LOOKS.jeans)
    expect(feetLook(shoes)).toBe(FEET_LOOKS.sneakers)
  })

  test('every wearable is an item, and every slot has something to find', () => {
    for (const [id, g] of Object.entries(GEAR)) {
      expect(ITEMS[id]?.kind).toBe('wear')
      expect(g.look).toBeGreaterThan(0)
      expect(g.look).toBeLessThan(16)
    }
    for (const slot of WEAR_SLOTS) {
      expect(Object.values(GEAR).some((g) => g.slot === slot)).toBe(true)
    }
  })

  test('barefoot is a bit louder; shoes keep their quiet', () => {
    expect(wornStats({ wear: {} }).quiet).toBeLessThan(0)
    expect(wornStats({ wear: { feet: 'sneakers' } }).quiet).toBeCloseTo(0.15)
    expect(wornStats({ wear: { feet: 'boots' } }).quiet).toBeCloseTo(0.3)
  })
})

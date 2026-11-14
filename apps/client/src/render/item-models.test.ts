import { describe, expect, test } from 'bun:test'
import { ITEM_LIST } from '@office-fps/shared'
import { hasOwnModel, itemModel } from './item-models.ts'

describe('item models', () => {
  test('every item has a model of its own', () => {
    const missing = ITEM_LIST.filter((d) => !hasOwnModel(d.id)).map((d) => d.id)
    expect(missing).toEqual([])
  })

  test('every model rests on the ground, centred, at a believable size', () => {
    for (const def of ITEM_LIST) {
      const m = itemModel(def.id)
      const [w, h, d] = m.size
      expect(m.positions.length, def.id).toBeGreaterThan(0)
      expect(m.positions.length / 3, def.id).toBe(m.uvs.length / 2)
      // Nothing smaller than a ring, nothing bigger than a long gun or a stack of planks.
      expect(Math.max(w, h, d), def.id).toBeGreaterThan(0.015)
      expect(Math.max(w, d), def.id).toBeLessThan(1.6)
      expect(h, def.id).toBeLessThan(0.8)
      // Under 1500 triangles each: a shelf of them stays cheap.
      expect(m.positions.length / 9, def.id).toBeLessThan(1500)
      let minY = Infinity
      for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i] ?? 0)
      expect(minY, def.id).toBeCloseTo(0, 5)
    }
  })

  test('an unknown item still gets something to pick up', () => {
    expect(itemModel('no-such-thing').positions.length).toBeGreaterThan(0)
  })

  test('models are built once', () => {
    expect(itemModel('beans')).toBe(itemModel('beans'))
  })
})

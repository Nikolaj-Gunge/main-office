import { describe, expect, test } from 'bun:test'
import {
  FAR_EVERY,
  INTEREST_FAR,
  INTEREST_NEAR,
  type InterestEntity,
  pickInterest,
  SpatialGrid,
} from './interest.ts'

const viewer = { id: 1, x: 0, z: 0 }

function pick(entities: InterestEntity[], known: number[] = [], snapshot = 0) {
  const all = [{ id: 1, x: 0, z: 0, person: true }, ...entities]
  return pickInterest(
    viewer,
    new SpatialGrid(all),
    all.filter((e) => e.person),
    new Set(known),
    snapshot,
  )
}

describe('area of interest', () => {
  test('the grid finds everyone in range, wherever the cell lines fall', () => {
    const grid = new SpatialGrid([
      { id: 2, x: -63.9, z: 0.1, person: false },
      { id: 3, x: 199, z: -1, person: false },
      { id: 4, x: 900, z: 900, person: false },
    ])
    const seen: number[] = []
    grid.near(0, 0, 200, (e) => seen.push(e.id))
    expect(seen.sort()).toEqual([2, 3])
  })

  test('near: everyone, every snapshot; zombies beyond it are not sent at all', () => {
    const out = pick([
      { id: 2, x: 50, z: 50, person: false },
      { id: 3, x: INTEREST_NEAR - 1, z: 0, person: true },
      { id: 4, x: INTEREST_NEAR + 50, z: 0, person: false },
    ])
    expect(out.send.sort()).toEqual([2, 3])
    expect(out.removed).toEqual([])
  })

  test('far people: straight away on entering, then one snapshot in FAR_EVERY', () => {
    const far = { id: 7, x: 0, z: 350, person: true }
    expect(pick([far]).send).toEqual([7])
    let sent = 0
    for (let s = 0; s < FAR_EVERY * 10; s++) sent += pick([far], [7], s).send.length
    expect(sent).toBe(10)
  })

  test('out of range: removed once known, never sent; the edge has some give', () => {
    const gone = { id: 8, x: INTEREST_FAR + 100, z: 0, person: true }
    expect(pick([gone])).toEqual({ send: [], removed: [] })
    expect(pick([gone], [8])).toEqual({ send: [], removed: [8] })
    // A zombie just past the near edge: not let in, but not dropped if already known.
    const edge = { id: 9, x: INTEREST_NEAR + 5, z: 0, person: false }
    expect(pick([edge]).send).toEqual([])
    expect(pick([edge], [9]).send).toEqual([9])
    // Players who left the game are removed too.
    expect(pick([], [42]).removed).toEqual([42])
  })

  test('never yourself', () => {
    expect(pick([], [1]).send).toEqual([])
  })
})

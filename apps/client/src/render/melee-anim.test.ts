import { describe, expect, test } from 'bun:test'
import { WEAPONS, WeaponId } from '@office-fps/shared'
import { meleePose, meleeReady, SWING_OF, type SwingKind } from './melee-anim.ts'

describe('melee swings', () => {
  test('every melee weapon has a swing, and they are not all the same', () => {
    const melee = Object.values(WEAPONS).filter(
      (w) => w.slot === 'melee' && w.id !== WeaponId.Claws,
    )
    for (const w of melee) expect(SWING_OF[w.id]).toBeDefined()
    const shapes = new Set(
      (Object.values(SWING_OF) as SwingKind[]).map((k) => JSON.stringify(meleePose(k, 0.15))),
    )
    expect(shapes.size).toBe(new Set(Object.values(SWING_OF)).size)
  })

  test('the bat sweeps across the view: far left of where it was held, turned round', () => {
    const ready = meleeReady('swing')
    const mid = meleePose('swing', 0.3)
    expect(mid.x).toBeLessThan(ready.x - 0.2)
    expect(mid.ry).toBeGreaterThan(ready.ry + 1)
  })

  test('the sledge comes down: pitched far below its ready pose', () => {
    expect(meleePose('slam', 0.3).rx).toBeLessThan(meleeReady('slam').rx - 0.7)
  })

  test('every swing ends where it started, mirrored or not', () => {
    for (const kind of new Set(Object.values(SWING_OF)) as Set<SwingKind>) {
      for (const mirror of [false, true]) {
        const end = meleePose(kind, 1, mirror)
        const ready = meleeReady(kind)
        for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) {
          expect(end[k]).toBeCloseTo(ready[k], 5)
        }
      }
    }
  })
})

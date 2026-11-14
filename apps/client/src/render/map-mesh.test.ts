import { describe, expect, test } from 'bun:test'
import { MAPS } from '@office-fps/shared'
import { renderBounds } from './map-mesh.ts'
import { isTransparent } from './textures.ts'

describe('map rendering', () => {
  for (const [id, build] of Object.entries(MAPS)) {
    test(`${id}: no two surfaces of different materials share a plane (no flickering)`, () => {
      const map = build()
      const start = performance.now()
      const bounds = renderBounds(map)
      const ms = performance.now() - start
      const clashes: string[] = []
      // Sweep along x: boxes that can clash at all touch or overlap in x.
      const order = bounds.flatMap((b, i) => (b ? [i] : []))
      order.sort((i, j) => (bounds[i]?.min[0] ?? 0) - (bounds[j]?.min[0] ?? 0))
      for (let p = 0; p < order.length; p++) {
        for (let q = p + 1; q < order.length; q++) {
          const [i, j] = [order[p] ?? 0, order[q] ?? 0].sort((x, y) => x - y) as [number, number]
          const a = bounds[i]
          const b = bounds[j]
          if (!a || !b) continue
          const first = bounds[order[p] ?? 0]
          if ((bounds[order[q] ?? 0]?.min[0] ?? 0) > (first?.max[0] ?? 0) + 1e-3) break
          if (map.boxes[i]?.material === map.boxes[j]?.material) continue
          for (let axis = 0; axis < 3; axis++) {
            const overlap = [0, 1, 2].every(
              (k) =>
                k === axis ||
                Math.min(a.max[k] ?? 0, b.max[k] ?? 0) - Math.max(a.min[k] ?? 0, b.min[k] ?? 0) >
                  1e-3,
            )
            if (!overlap) continue
            // Glass is double-sided: touching faces (pane on a frame) fight as well.
            const glass = [map.boxes[i], map.boxes[j]].some((x) => x && isTransparent(x.material))
            if (
              glass &&
              (Math.abs((a.min[axis] ?? 0) - (b.max[axis] ?? 0)) < 1e-4 ||
                Math.abs((a.max[axis] ?? 0) - (b.min[axis] ?? 0)) < 1e-4)
            ) {
              clashes.push(`#${i} / #${j} glass touching`)
            }
            for (const side of ['min', 'max'] as const) {
              if (Math.abs((a[side][axis] ?? 0) - (b[side][axis] ?? 0)) < 1e-4) {
                clashes.push(`#${i} ${map.boxes[i]?.material} / #${j} ${map.boxes[j]?.material}`)
              }
            }
          }
        }
      }
      expect(clashes.slice(0, 5)).toEqual([])
      // Runs once when the map loads (~400 ms for Deadwood on its own; a busy machine doubles it).
      expect(ms).toBeLessThan(1500)
    })
  }
})

import { describe, expect, test } from 'bun:test'
import { MAPS } from '@office-fps/shared'
import { renderBounds } from './map-mesh.ts'

describe('map rendering', () => {
  for (const [id, build] of Object.entries(MAPS)) {
    test(`${id}: no two surfaces of different materials share a plane (no flickering)`, () => {
      const map = build()
      const start = performance.now()
      const bounds = renderBounds(map)
      const ms = performance.now() - start
      const clashes: string[] = []
      for (let i = 0; i < bounds.length; i++) {
        for (let j = i + 1; j < bounds.length; j++) {
          const a = bounds[i]
          const b = bounds[j]
          if (!a || !b || map.boxes[i]?.material === map.boxes[j]?.material) continue
          for (let axis = 0; axis < 3; axis++) {
            const overlap = [0, 1, 2].every(
              (k) =>
                k === axis ||
                Math.min(a.max[k] ?? 0, b.max[k] ?? 0) - Math.max(a.min[k] ?? 0, b.min[k] ?? 0) >
                  1e-3,
            )
            if (!overlap) continue
            for (const side of ['min', 'max'] as const) {
              if (Math.abs((a[side][axis] ?? 0) - (b[side][axis] ?? 0)) < 1e-4) {
                clashes.push(`#${i} ${map.boxes[i]?.material} / #${j} ${map.boxes[j]?.material}`)
              }
            }
          }
        }
      }
      expect(clashes.slice(0, 5)).toEqual([])
      expect(ms).toBeLessThan(500) // runs once when the map loads
    })
  }
})

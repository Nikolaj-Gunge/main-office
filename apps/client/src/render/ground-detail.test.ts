import { describe, expect, test } from 'bun:test'
import { buildDeadwood, CHUNK, chunkOf, RoadGrid, WORLD_HALF } from '@office-fps/shared'
import { buildDetail, DetailKind, detailItems } from './ground-detail.ts'

const def = buildDeadwood().survival
if (!def) throw new Error('Deadwood has no survival world')
const roads = new RoadGrid(def.roads)

/** Chunks a road runs through (a stretch of the highway) and some deep forest. */
const highway = def.roads[0]
if (!highway) throw new Error('no roads')
const roadChunks = [
  ...new Set(highway.line.slice(0, 200).map((p) => chunkOf(p.x, p.z).join(','))),
].map((k) => k.split(',').map(Number) as [number, number])

describe('ground detail', () => {
  test('is the same every time for a chunk', () => {
    const [cx, cz] = chunkOf(-620, -500)
    const a = detailItems(def, roads, cx, cz)
    const b = detailItems(def, roads, cx, cz)
    expect(a.length).toBeGreaterThan(300)
    expect(b).toEqual(a)
  })

  test('never lies on a road or the flat ground of a place', () => {
    for (const [cx, cz] of roadChunks) {
      for (const it of detailItems(def, roads, cx, cz)) {
        expect(roads.edgeDistance(it.x, it.z)).toBeGreaterThan(0.3)
        for (const p of def.pois) expect(Math.hypot(p.x - it.x, p.z - it.z)).toBeGreaterThan(p.r)
      }
    }
  })

  test('the forest floor has a bit of everything, a few mushrooms glow', () => {
    const kinds = new Set<number>()
    let glow = 0
    const [cx, cz] = chunkOf(-620, -500)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const it of detailItems(def, roads, cx + dx, cz + dz)) {
          kinds.add(it.kind)
          if (it.glow) glow++
          const x0 = (cx + dx) * CHUNK - WORLD_HALF
          // Items belong to their chunk (props-anchored ones may sit a little outside).
          expect(it.x).toBeGreaterThan(x0 - 2)
          expect(it.x).toBeLessThan(x0 + CHUNK + 2)
        }
      }
    }
    for (const k of [
      DetailKind.Grass,
      DetailKind.Twig,
      DetailKind.Litter,
      DetailKind.Fern,
      DetailKind.Mushrooms,
      DetailKind.Moss,
    ])
      expect(kinds.has(k)).toBe(true)
    expect(glow).toBeGreaterThan(0)
  })

  test('builds swaying, fading geometry: a few thousand triangles a chunk', () => {
    const [cx, cz] = chunkOf(-620, -500)
    const { main } = buildDetail(def.terrain, detailItems(def, roads, cx, cz))
    if (!main) throw new Error('nothing built')
    const count = main.getAttribute('position').count
    expect(main.getAttribute('sway').count).toBe(count)
    expect(main.getAttribute('anchor').count).toBe(count)
    expect(count / 3).toBeGreaterThan(2000)
    expect(count / 3).toBeLessThan(20000)
  })
})

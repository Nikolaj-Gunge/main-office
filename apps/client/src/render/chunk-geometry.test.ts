import { describe, expect, test } from 'bun:test'
import { buildDeadwood, chunkOf, chunkProps } from '@office-fps/shared'
import { ChunkBuilder } from './chunk-builder.ts'
import { type ChunkJob, ChunkMaker, type ChunkResult, Detail } from './chunk-geometry.ts'
import type { GeometryData } from './geometry-data.ts'
import { toGeometry } from './geometry-data.ts'

const def = buildDeadwood().survival
if (!def) throw new Error('Deadwood has no survival world')

/** Deep forest, Haven, open ground, a road. */
const spots = [chunkOf(-620, -500), chunkOf(-142, 930), chunkOf(300, 200), chunkOf(0, 0)]
const jobs: ChunkJob[] = spots.flatMap(([cx, cz]) => [
  { kind: 'chunk', cx, cz, level: Detail.Full },
  { kind: 'props', cx, cz, level: Detail.Simple },
  { kind: 'detail', cx, cz, density: 1 },
])

/** The geometries in a result, by name. */
function geometries(r: ChunkResult): Record<string, GeometryData | null> {
  if (r.kind === 'chunk') return { ground: r.ground, props: r.props }
  if (r.kind === 'props') return { props: r.props }
  return { main: r.main, glow: r.glow }
}

/** Runs the jobs through a builder and waits for every result. */
async function viaWorker(list: ChunkJob[]): Promise<ChunkResult[]> {
  const builder = new ChunkBuilder(def as NonNullable<typeof def>, true)
  expect(builder.threaded).toBe(true)
  for (const job of list) builder.request(job)
  const out: ChunkResult[] = []
  const until = Date.now() + 20000
  while (out.length < list.length && Date.now() < until) {
    out.push(...builder.take())
    await new Promise((r) => setTimeout(r, 5))
  }
  builder.dispose()
  return out
}

describe('chunk geometry', () => {
  test('the worker builds exactly what the main thread builds', async () => {
    const maker = new ChunkMaker(def)
    const results = await viaWorker(jobs)
    expect(results.length).toBe(jobs.length)
    for (const [i, job] of jobs.entries()) {
      const fromWorker = results[i] as ChunkResult
      const here = maker.make(job)
      expect(fromWorker.kind).toBe(job.kind)
      expect([fromWorker.cx, fromWorker.cz]).toEqual([job.cx, job.cz])
      const a = geometries(here)
      const b = geometries(fromWorker)
      for (const name of Object.keys(a)) {
        const ga = a[name]
        const gb = b[name]
        if (!ga) {
          expect(gb).toBeNull()
          continue
        }
        expect(gb).not.toBeNull()
        expect(gb?.attributes.map((x) => x.name)).toEqual(ga.attributes.map((x) => x.name))
        ga.attributes.forEach((attr, k) => {
          expect(gb?.attributes[k]?.itemSize).toBe(attr.itemSize)
          expect(gb?.attributes[k]?.array).toEqual(attr.array)
        })
        expect(gb?.index ?? null).toEqual(ga.index)
        expect(gb?.sphere).toEqual(ga.sphere)
      }
      if (fromWorker.kind === 'chunk' && here.kind === 'chunk')
        expect(fromWorker.items).toEqual(here.items)
    }
  }, 30000)

  test('the bounding sphere is the one three.js works out', () => {
    const maker = new ChunkMaker(def)
    const [cx, cz] = spots[0] as [number, number]
    const r = maker.make({ kind: 'chunk', cx, cz, level: Detail.Full })
    if (r.kind !== 'chunk') throw new Error('not a chunk')
    for (const data of [r.ground, r.props]) {
      const ours = toGeometry(data)
      const theirs = toGeometry({ ...data, sphere: null })
      theirs.computeBoundingSphere()
      expect(ours.boundingSphere?.center.toArray()).toEqual(theirs.boundingSphere?.center.toArray())
      expect(ours.boundingSphere?.radius).toBe(theirs.boundingSphere?.radius as number)
    }
  })

  test('a chunk carries what grows there, and fewer triangles when simplified', () => {
    const maker = new ChunkMaker(def)
    const [cx, cz] = spots[0] as [number, number]
    const full = maker.make({ kind: 'props', cx, cz, level: Detail.Full })
    const simple = maker.make({ kind: 'props', cx, cz, level: Detail.Simple })
    const chunk = maker.make({ kind: 'chunk', cx, cz, level: Detail.Full })
    if (full.kind !== 'props' || simple.kind !== 'props' || chunk.kind !== 'chunk')
      throw new Error('wrong kinds')
    const count = (g: GeometryData) => (g.attributes[0]?.array.length ?? 0) / 3
    expect(count(simple.props)).toBeLessThan(count(full.props) / 2)
    expect(simple.props.attributes.some((a) => a.name === 'sway')).toBe(false)
    expect(chunk.items).toEqual(chunkProps(def.terrain, def.seed, cx, cz))
  })

  test('thinner ground detail keeps the rarer things', () => {
    const maker = new ChunkMaker(def)
    const [cx, cz] = spots[0] as [number, number]
    const tris = (density: number) => {
      const r = maker.make({ kind: 'detail', cx, cz, density })
      if (r.kind !== 'detail' || !r.main) throw new Error('no detail')
      return (r.main.attributes[0]?.array.length ?? 0) / 9
    }
    const all = tris(1)
    expect(tris(0.4)).toBeLessThan(all * 0.75)
    expect(tris(0.4)).toBeGreaterThan(all * 0.2)
  })
})

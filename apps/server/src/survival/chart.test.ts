import { describe, expect, test } from 'bun:test'
import {
  bitsToText,
  CHART_BYTES,
  CHART_CELL,
  CHART_GRID,
  chartArea,
  chartCell,
  charted,
  chartShare,
  countBits,
  emptyBits,
  mergeBits,
  type Poi,
  readChart,
  revealAround,
  type SurvivalSelf,
  textToBits,
} from '@office-fps/shared'
import type { Saves } from '../saves.ts'
import { Cartographer, CHART_KEY, type ChartSurvivor } from './chart.ts'

describe('the chart bitset', () => {
  test('is compact, and survives base64 and back', () => {
    expect(CHART_BYTES).toBe((CHART_GRID * CHART_GRID) / 8)
    expect(CHART_BYTES).toBeLessThanOrEqual(1200)
    const bits = emptyBits()
    revealAround(bits, 0, 0)
    revealAround(bits, -1500, 1500)
    const text = bitsToText(bits)
    expect(text.length).toBe((CHART_BYTES / 3) * 4)
    expect(textToBits(text)).toEqual(bits)
  })

  test('malformed text reads as a blank map', () => {
    expect(countBits(textToBits('nope'))).toBe(0)
    expect(countBits(textToBits(42))).toBe(0)
    expect(countBits(textToBits('!'.repeat((CHART_BYTES / 3) * 4)))).toBe(0)
  })

  test('walking fills in the squares around you, and only once', () => {
    const bits = emptyBits()
    const first = revealAround(bits, 100, 100)
    expect(first).toBeGreaterThan(4)
    expect(charted(bits, 100, 100)).toBe(true)
    expect(charted(bits, 100 + CHART_CELL, 100)).toBe(true)
    expect(charted(bits, 600, 600)).toBe(false)
    expect(revealAround(bits, 100, 100)).toBe(0)
    // Off the edge of the world nothing breaks.
    expect(chartCell(99999, 0)).toBe(-1)
    revealAround(bits, 1535, 1535)
    expect(charted(bits, 1530, 1530)).toBe(true)
  })

  test('maps merge, only ever growing', () => {
    const a = emptyBits()
    const b = emptyBits()
    revealAround(a, 0, 0)
    revealAround(b, 500, 0)
    const n = countBits(a) + countBits(b)
    expect(mergeBits(a, b)).toBe(true)
    expect(countBits(a)).toBe(n)
    expect(mergeBits(a, b)).toBe(false)
  })

  test('a saved chart reads defensively', () => {
    const c = readChart({ seen: 5, inked: ['haven', 3, 'church'] })
    expect(c.inked).toEqual(['haven', 'church'])
    expect(countBits(textToBits(c.seen))).toBe(0)
    expect(readChart(null).inked).toEqual([])
  })
})

// --- The cartographer, on a pretend world ------------------------------------------------------

const POIS = [
  { key: 'haven', name: 'Haven', x: 0, z: 0, r: 30 },
  { key: 'church', name: 'Church', x: 800, z: 800, r: 20 },
] as unknown as Poi[]

function world() {
  const accounts = new Map<string, Record<string, unknown>>()
  const notices: string[] = []
  const saves = {
    account: (a: string) => accounts.get(a) ?? {},
    putAccount: (a: string, key: string, value: unknown) => {
      accounts.set(a, { ...(accounts.get(a) ?? {}), [key]: value })
    },
  } as unknown as Saves
  const carto = new Cartographer({
    saves: () => saves,
    pois: () => POIS,
    notice: (_sv, _kind, text) => {
      notices.push(text)
    },
  })
  const sv: ChartSurvivor = {
    player: { id: 1, account: 'acct', state: { alive: true, pos: { x: 0, z: 0 } } },
    self: {} as SurvivalSelf,
    dirty: false,
  }
  return { accounts, notices, carto, sv }
}

describe('the cartographer', () => {
  test('draws where you walk and inks the places you set foot in', () => {
    const { carto, sv } = world()
    carto.second(sv)
    expect(sv.self.chart?.inked).toEqual(['haven'])
    expect(charted(textToBits(sv.self.chart?.seen), 0, 0)).toBe(true)
    expect(charted(textToBits(sv.self.chart?.seen), 800, 800)).toBe(false)
    sv.player.state.pos = { x: 800, z: 800 }
    carto.second(sv)
    expect(sv.self.chart?.inked).toEqual(['haven', 'church'])
    expect(charted(textToBits(sv.self.chart?.seen), 800, 800)).toBe(true)
  })

  test('the map goes out only when it changes; the old map once', () => {
    const { carto, sv } = world()
    carto.second(sv)
    const first = carto.outgoing(sv, { ...sv.self })
    expect(first.chart).toBeDefined()
    expect(first.oldChart).toBeDefined()
    carto.second(sv)
    const again = carto.outgoing(sv, { ...sv.self })
    expect(again.chart).toBeUndefined()
    expect(again.oldChart).toBeUndefined()
    sv.player.state.pos = { x: 300, z: 0 }
    carto.second(sv)
    expect(carto.outgoing(sv, { ...sv.self }).chart).toBeDefined()
  })

  test('the dead stop drawing', () => {
    const { carto, sv } = world()
    sv.player.state.alive = false
    carto.second(sv)
    expect(countBits(textToBits(sv.self.chart?.seen))).toBe(0)
  })

  test('a new character starts blank over the faded map of the ones before', () => {
    const { accounts, carto, sv } = world()
    carto.second(sv)
    carto.outgoing(sv, { ...sv.self })
    const drawn = countBits(textToBits(sv.self.chart?.seen))
    // Died: a fresh self, no map.
    sv.self = {} as SurvivalSelf
    carto.second(sv)
    // Standing in the same place, the new one has drawn the same squares — but no more.
    expect(countBits(textToBits(sv.self.chart?.seen))).toBe(drawn)
    const out = carto.outgoing(sv, { ...sv.self })
    expect(countBits(textToBits(out.oldChart))).toBe(drawn)
    const saved = accounts.get('acct')?.[CHART_KEY] as { seen: string }
    expect(countBits(textToBits(saved.seen))).toBe(drawn)
  })

  test('leaving keeps the old map in the account; coming back brings it', () => {
    const { accounts, carto, sv } = world()
    sv.player.state.pos = { x: 800, z: 800 }
    carto.second(sv)
    const chart = sv.self.chart
    carto.forget(sv)
    expect(accounts.get('acct')?.[CHART_KEY]).toBeDefined()
    // Back as the same character (their chart saved with them).
    const back: ChartSurvivor = { ...sv, self: { chart } as SurvivalSelf }
    carto.second(back)
    expect(charted(textToBits(back.self.chart?.seen), 800, 800)).toBe(true)
    expect(back.self.chart?.inked).toEqual(['church'])
    const out = carto.outgoing(back, { ...back.self })
    expect(charted(textToBits(out.oldChart), 800, 800)).toBe(true)
  })

  test('the share counts the county round its places, not the whole forest', () => {
    const area = chartArea(POIS)
    const bits = emptyBits()
    // Out in the deep forest, far from every place: not counted.
    revealAround(bits, -1400, -1400)
    expect(chartShare(bits, area)).toBe(0)
    expect(chartShare(bits)).toBeGreaterThan(0)
    // Everything round the places: all of it.
    for (let x = -300; x < 1100; x += 40)
      for (let z = -300; z < 1100; z += 40) revealAround(bits, x, z)
    expect(chartShare(bits, area)).toBe(1)
    expect(chartShare(bits)).toBeLessThan(0.5)
    // Hidden places (out in the deep forest) don't widen it.
    const hidden = { key: 'stash', name: 'Stash', x: -1400, z: -1400, r: 5, hidden: true } as Poi
    expect(chartArea([...POIS, hidden])).toEqual(area)
  })

  test('milestones are told', () => {
    const { carto, notices, sv } = world()
    // Walking the county round its places (the forest beyond doesn't count): up to 75%.
    for (let x = -300; x < 1100; x += 60)
      for (let z = -300; z < 1100; z += 60) {
        sv.player.state.pos = { x, z }
        carto.second(sv)
      }
    expect(notices.some((n) => n.includes('of Deadwood County drawn in'))).toBe(true)
    expect(notices.some((n) => n.includes('75%'))).toBe(true)
  })
})

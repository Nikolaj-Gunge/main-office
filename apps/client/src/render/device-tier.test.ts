import { describe, expect, test } from 'bun:test'
import {
  AutoTier,
  type DeviceInfo,
  effectiveTier,
  TIER_SETTINGS,
  type TierStore,
  tierFromDevice,
  tierFromProbe,
} from './device-tier.ts'

const desktop = (gpu: string, memory: number | null = 8, cores: number | null = 8): DeviceInfo => ({
  gpu,
  memory,
  cores,
  mobile: false,
  ios: false,
})

function memoryStore(): TierStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
  }
}

/** Feeds `seconds` of frames `ms` long. */
function play(auto: AutoTier, seconds: number, ms: number, coarsest = false): boolean {
  let changed = false
  for (let t = 0; t < seconds; t += ms / 1000) if (auto.frame(ms / 1000, coarsest)) changed = true
  return changed
}

describe('device tiers', () => {
  test('from the GPU, memory, cores and phone', () => {
    expect(tierFromDevice(desktop('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11)'))).toBe(
      'high',
    )
    expect(tierFromDevice(desktop('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)'))).toBe(
      'high',
    )
    expect(tierFromDevice(desktop('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'))).toBe(
      'medium',
    )
    expect(tierFromDevice(desktop('ANGLE (Intel, Intel(R) HD Graphics 4000)', 2, 4))).toBe('low')
    expect(tierFromDevice(desktop('SwiftShader Device (LLVM 10.0.0)'))).toBe('low')
    expect(tierFromDevice(desktop('ANGLE (NVIDIA GeForce GTX 1050)', 4, 4))).toBe('medium')
    // The browser won't name it: judge by the rest.
    expect(tierFromDevice(desktop('', 8, 12))).toBe('high')
    expect(tierFromDevice(desktop('', null, 8))).toBe('medium')
    expect(tierFromDevice(desktop('', 4, 4))).toBe('low')
    // Phones: iOS always low; Android by what it has.
    expect(
      tierFromDevice({ gpu: 'Apple GPU', memory: null, cores: 6, mobile: true, ios: true }),
    ).toBe('low')
    expect(
      tierFromDevice({ gpu: 'Adreno (TM) 740', memory: 8, cores: 8, mobile: true, ios: false }),
    ).toBe('low')
    expect(
      tierFromDevice({ gpu: 'Xclipse 920', memory: 8, cores: 8, mobile: true, ios: false }),
    ).toBe('medium')
  })

  test('the probe only ever steps down', () => {
    expect(tierFromProbe('high', 16.7)).toBe('high')
    expect(tierFromProbe('high', 33)).toBe('medium')
    expect(tierFromProbe('medium', 33)).toBe('low')
    expect(tierFromProbe('high', 60)).toBe('low')
    expect(tierFromProbe('low', 8)).toBe('low')
  })

  test('the menu choice wins over auto', () => {
    expect(effectiveTier('auto', 'medium')).toBe('medium')
    expect(effectiveTier('high', 'low')).toBe('high')
  })

  test('tiers get cheaper from high to low', () => {
    const { low, medium, high } = TIER_SETTINGS
    for (const key of [
      'shadowMap',
      'forestNear',
      'forestMid',
      'forestFar',
      'detailView',
      'detailDensity',
      'casings',
      'decals',
      'maxDpr',
      'fogFar',
      'lamps',
      'leaves',
    ] as const) {
      expect(low[key]).toBeLessThanOrEqual(medium[key])
      expect(medium[key]).toBeLessThanOrEqual(high[key])
    }
    expect(low.maxDpr).toBe(1)
    expect([low.shadowMap, medium.shadowMap, high.shadowMap]).toEqual([1024, 2048, 2048])
    // Simplified trees start past the full ones, and the cards past those.
    for (const t of [low, medium, high]) {
      expect(t.forestMid).toBeGreaterThan(t.forestNear)
      expect(t.forestFar).toBeGreaterThan(t.forestMid)
    }
  })

  test('auto: detected once, probed once, remembered', () => {
    const store = memoryStore()
    const gpu = desktop('ANGLE (NVIDIA GeForce RTX 3070)')
    const auto = new AutoTier(gpu, store)
    expect(auto.tier).toBe('high')
    expect(auto.probing).toBe(true)
    // Slow frames through the probe (after the first seconds are skipped): one step down.
    expect(play(auto, 7, 35)).toBe(true)
    expect(auto.tier).toBe('medium')
    expect(auto.probing).toBe(false)
    // Next time: no detection, no probe.
    const again = new AutoTier(gpu, store)
    expect(again.tier).toBe('medium')
    expect(again.probing).toBe(false)
    // Another GPU starts over.
    expect(new AutoTier(desktop('ANGLE (Intel(R) UHD Graphics 620)'), store).probing).toBe(true)
  })

  test('auto steps down only when the coarsest pixels still run under 40 fps', () => {
    const auto = new AutoTier(desktop('ANGLE (NVIDIA GeForce RTX 3070)'), memoryStore())
    play(auto, 7, 16.7)
    expect(auto.tier).toBe('high')
    // Slow, but auto quality can still make pixels coarser: leave the tier alone.
    expect(play(auto, 20, 30, false)).toBe(false)
    // Slow at the coarsest pixels: one step after a few seconds, and another later.
    expect(play(auto, 4, 30, true)).toBe(false)
    expect(play(auto, 4, 30, true)).toBe(true)
    expect(auto.tier).toBe('medium')
    play(auto, 10, 30, true)
    expect(auto.tier).toBe('low')
    // Stalls (a hidden tab) don't count.
    expect(auto.frame(1, true)).toBe(false)
  })
})

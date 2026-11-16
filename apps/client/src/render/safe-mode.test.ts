import { describe, expect, test } from 'bun:test'
import { safeReasons, TIER_SETTINGS, tierFromDevice } from './device-tier.ts'
import { safeModeOn, safeTier } from './safe-mode.ts'

const mac = { gpu: 'Apple M2', memory: 8, cores: 10, mobile: false, ios: false }

describe('safe mode', () => {
  test('auto turns on for Safari, ChromeOS and weak GPUs only', () => {
    expect(safeReasons(mac)).toEqual([])
    expect(safeReasons({ ...mac, safari: true })).toEqual(['Safari'])
    expect(safeReasons({ ...mac, chromeos: true })).toEqual(['ChromeOS'])
    expect(safeReasons({ ...mac, floatTargets: false })).toEqual(['no float textures'])
    expect(safeReasons({ ...mac, maxTexture: 2048 })).toEqual(['max texture 2048'])
  })

  test('URL flag beats the setting, the setting beats the device', () => {
    expect(safeModeOn('auto', [], '')).toBe(false)
    expect(safeModeOn('auto', ['Safari'], '')).toBe(true)
    expect(safeModeOn('off', ['Safari'], '')).toBe(false)
    expect(safeModeOn('on', [], '')).toBe(true)
    expect(safeModeOn('off', [], '?safe=1')).toBe(true)
    expect(safeModeOn('on', ['Safari'], '?safe=0')).toBe(false)
  })

  test('odd devices start on a safe tier', () => {
    expect(tierFromDevice({ ...mac, safari: true })).toBe('medium')
    expect(tierFromDevice({ ...mac, chromeos: true, gpu: 'Mali-G52' })).toBe('low')
    expect(tierFromDevice({ ...mac, floatTargets: false })).toBe('low')
    expect(tierFromDevice({ ...mac, maxTexture: 2048 })).toBe('low')
  })

  test('safe tier keeps one shadow map and no AO', () => {
    const t = safeTier(TIER_SETTINGS.high)
    expect(t.shadowCascades).toEqual([TIER_SETTINGS.high.shadowReach])
    expect(t.ao).toBe(0)
  })
})

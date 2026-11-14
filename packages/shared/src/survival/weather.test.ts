import { describe, expect, test } from 'bun:test'
import {
  flashAt,
  hearingScale,
  sightScale,
  strikesBetween,
  WEATHER_KINDS,
  WEATHER_PRESETS,
  type WeatherKind,
  weatherAt,
  weatherMix,
} from './weather.ts'

const HOURS = 6 * 3600

describe('weather', () => {
  test('the same seed and clock always give the same weather, and other seeds other weather', () => {
    const a = Array.from({ length: 200 }, (_, i) => weatherAt(1234, i * 97.3))
    const b = Array.from({ length: 200 }, (_, i) => weatherAt(1234, i * 97.3))
    expect(a).toEqual(b)
    const c = Array.from({ length: 200 }, (_, i) => weatherAt(4321, i * 97.3))
    expect(c.map((w) => w.kind)).not.toEqual(a.map((w) => w.kind))
    expect(strikesBetween(1234, 0, HOURS)).toEqual(strikesBetween(1234, 0, HOURS))
  })

  test('every kind comes round, spells last minutes, and the change is gradual', () => {
    const seen = new Map<WeatherKind, number>()
    const spells: number[] = []
    let low = 1
    let high = 0
    let step = 0
    for (let seed = 1; seed <= 12; seed++) {
      let prev = weatherAt(seed * 7919, 0)
      let since = 0
      for (let t = 1; t < HOURS; t++) {
        const w = weatherAt(seed * 7919, t)
        for (const k of ['cloud', 'rain', 'fog', 'storm', 'wind'] as const) {
          low = Math.min(low, w[k])
          high = Math.max(high, w[k])
          step = Math.max(step, Math.abs(w[k] - prev[k]))
        }
        seen.set(w.kind, (seen.get(w.kind) ?? 0) + 1)
        if (w.kind !== prev.kind) {
          spells.push(t - since)
          since = t
        }
        prev = w
      }
    }
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
    // Never a jump: a second of weather moves every channel only a hair (a minute, all the way).
    expect(step).toBeLessThan(0.02)
    for (const kind of WEATHER_KINDS) expect(seen.get(kind) ?? 0).toBeGreaterThan(HOURS * 0.2)
    // Clear skies are commoner than storms.
    expect(seen.get('clear') ?? 0).toBeGreaterThan(seen.get('storm') ?? 0)
    spells.sort((x, y) => x - y)
    // Passing through drizzle on the way to rain can be quick; a typical spell is minutes.
    expect(spells[Math.floor(spells.length * 0.75)]).toBeGreaterThan(180)
  })

  test('the mix of kinds follows the channels', () => {
    for (const kind of WEATHER_KINDS) {
      const mix = weatherMix(WEATHER_PRESETS[kind])
      const top = WEATHER_KINDS.reduce((a, b) => (mix[b] > mix[a] ? b : a))
      expect(top).toBe(kind)
    }
    expect(weatherAt(5, 100, 'storm')).toEqual(WEATHER_PRESETS.storm)
  })

  test('lightning only in storms: a flash, then thunder from somewhere', () => {
    expect(strikesBetween(99, 0, 600, 'rain')).toEqual([])
    const strikes = strikesBetween(99, 0, 60, 'storm')
    expect(strikes.length).toBeGreaterThan(2)
    expect(strikes.length).toBeLessThan(15)
    for (const s of strikes) {
      expect(s.at).toBeGreaterThan(0)
      expect(s.at).toBeLessThanOrEqual(60)
      expect(s.distance).toBeGreaterThan(100)
      expect(flashAt(99, s.at + 0.02, 'storm')).toBeGreaterThan(0.2)
    }
    const first = strikes[0]
    if (!first) throw new Error('no strike')
    // Dark again a second later (unless the next bolt is already there).
    const later = first.at + 1.2
    if (!strikes.some((s) => s.at > first.at && s.at < later + 0.1)) {
      expect(flashAt(99, later, 'storm')).toBe(0)
    }
    // Asking in pieces finds the same strikes as asking at once.
    const pieces = [0, 15, 30, 45].flatMap((a) => strikesBetween(99, a, a + 15, 'storm'))
    expect(pieces).toEqual(strikes)
  })

  test('rain masks noise, fog shortens sight, lightning lengthens it', () => {
    const clear = WEATHER_PRESETS.clear
    expect(hearingScale(clear)).toBe(1)
    expect(hearingScale(WEATHER_PRESETS.rain)).toBeLessThan(0.75)
    expect(hearingScale(WEATHER_PRESETS.storm)).toBeLessThan(hearingScale(WEATHER_PRESETS.rain))
    // A gunshot is masked less than footsteps.
    expect(hearingScale(WEATHER_PRESETS.rain, true)).toBeGreaterThan(
      hearingScale(WEATHER_PRESETS.rain),
    )
    expect(sightScale(clear, 0)).toBe(1)
    expect(sightScale(WEATHER_PRESETS.fog, 0)).toBeLessThan(0.7)
    expect(sightScale(WEATHER_PRESETS.storm, 1)).toBeGreaterThan(1.5)
  })
})

import { describe, expect, test } from 'bun:test'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import {
  COLD_AT,
  effectsOf,
  freshNeeds,
  infectionRate,
  needsDrain,
  REST_SIT_SECONDS,
  RESTED_SECONDS,
  STARVE_FLOOR,
  type Surroundings,
  starveHurt,
  stepNeeds,
  tuneMovement,
  WET_AT,
  wornWarmth,
} from './needs.ts'

const outside: Surroundings = {
  night: 0,
  rain: 0,
  indoors: false,
  byFire: false,
  inWater: false,
  still: false,
}
const bare = { warmth: 0, dry: 0 }
const run = (n = freshNeeds(), at: Partial<Surroundings>, seconds: number, clothes = bare) => {
  let rested = false
  for (let i = 0; i < seconds; i++)
    rested = stepNeeds(n, { ...outside, ...at }, clothes, 1) || rested
  return { n, rested }
}

describe('needs: buffs', () => {
  test('Well fed and Hydrated above 70, not at 70', () => {
    expect(effectsOf({ hunger: 70, thirst: 70 })).toEqual([])
    expect(effectsOf({ hunger: 71, thirst: 70.5 })).toEqual(['fed', 'hydrated'])
  })

  test('Starving and Parched at 10 and below', () => {
    expect(effectsOf({ hunger: 11, thirst: 40 })).toEqual([])
    expect(effectsOf({ hunger: 10, thirst: 0 })).toEqual(['starving', 'parched'])
  })

  test('sitting by a fire for 20 s leaves you Rested for 20 minutes', () => {
    const { n, rested } = run(undefined, { byFire: true, still: true }, REST_SIT_SECONDS - 1)
    expect(rested).toBe(false)
    expect(stepNeeds(n, { ...outside, byFire: true, still: true }, bare, 1)).toBe(true)
    expect(n.rested).toBe(RESTED_SECONDS)
    expect(effectsOf({ hunger: 50, thirst: 50, needs: n })).toEqual(['rested'])
    run(n, {}, RESTED_SECONDS)
    expect(n.rested).toBe(0)
  })

  test('walking about by the fire, or sitting away from one, does not rest you', () => {
    expect(run(undefined, { byFire: true }, 60).n.rested).toBe(0)
    expect(run(undefined, { still: true }, 60).n.rested).toBe(0)
  })

  test('Rested slows the bite by 10 %', () => {
    expect(infectionRate(undefined)).toBe(1)
    expect(infectionRate({ ...freshNeeds(), rested: 30 })).toBeCloseTo(0.9)
  })

  test('buffs tune movement: longer sprint, faster breath; a sprain barely runs', () => {
    const base = { ...DEFAULT_MOVEMENT, sprintSeconds: 9 }
    const good = tuneMovement(base, ['fed', 'hydrated', 'rested'])
    expect(good.sprintSeconds).toBeGreaterThan(base.sprintSeconds * 1.4)
    expect(good.breathSeconds).toBeLessThan(base.breathSeconds)
    const hurt = tuneMovement(base, ['sprain', 'cold'])
    expect(hurt.sprintMultiplier).toBeLessThan(1.15)
    expect(hurt.breathSeconds).toBeGreaterThan(base.breathSeconds)
    expect(base.sprintSeconds).toBe(9)
  })

  test('one drain function, with a scale others can multiply', () => {
    const full = needsDrain()
    const half = needsDrain(0.5)
    expect(half.hunger).toBeCloseTo(full.hunger / 2)
    expect(half.thirst).toBeCloseTo(full.thirst / 2)
  })
})

describe('needs: penalties', () => {
  test('starving never takes health below 15', () => {
    expect(starveHurt(40, 1)).toBe(39)
    expect(starveHurt(STARVE_FLOOR + 1, 2)).toBe(STARVE_FLOOR)
    expect(starveHurt(STARVE_FLOOR, 2)).toBe(STARVE_FLOOR)
    // Already lower (bleeding, a bite): hunger doesn't add to it.
    expect(starveHurt(8, 2)).toBe(8)
  })
})

describe('needs: wet and cold', () => {
  test('rain soaks you outdoors, not indoors; a raincoat slows it', () => {
    expect(run(undefined, { rain: 0.65 }, 30).n.wet).toBeGreaterThan(WET_AT)
    expect(run(undefined, { rain: 0.65, indoors: true }, 30).n.wet).toBe(0)
    const coat = wornWarmth({ body: 'raincoat' })
    expect(run(undefined, { rain: 0.65 }, 30, coat).n.wet).toBeLessThan(WET_AT)
  })

  test('the lake soaks you at once', () => {
    expect(run(undefined, { inWater: true }, 3).n.wet).toBe(100)
  })

  test('a fire dries you faster than a roof, a roof faster than the air', () => {
    const left = (at: Partial<Surroundings>) => run({ ...freshNeeds(), wet: 100 }, at, 15).n.wet
    expect(left({ byFire: true })).toBeLessThan(left({ indoors: true }))
    expect(left({ indoors: true })).toBeLessThan(left({}))
  })

  test('a wet night with no jacket makes you Cold; the same dry, or by day, does not', () => {
    const wetNight = run({ ...freshNeeds(), wet: 100 }, { night: 1 }, 60).n
    expect(wetNight.chill).toBeGreaterThanOrEqual(COLD_AT)
    expect(effectsOf({ hunger: 50, thirst: 50, needs: wetNight })).toContain('cold')
    expect(run(undefined, { night: 1 }, 120).n.chill).toBe(0)
    expect(run({ ...freshNeeds(), wet: 100 }, { night: 0 }, 120).n.chill).toBe(0)
  })

  test('warm clothes keep a wet night out; a fire or a roof warms you back up', () => {
    const dressed = wornWarmth({ body: 'jacket', legs: 'jeans', feet: 'boots', head: 'beanie' })
    expect(dressed.warmth).toBeGreaterThanOrEqual(1)
    expect(run({ ...freshNeeds(), wet: 100 }, { night: 1 }, 60, dressed).n.chill).toBeLessThan(
      COLD_AT,
    )
    expect(
      run({ ...freshNeeds(), chill: 100 }, { night: 1, byFire: true }, 10).n.chill,
    ).toBeLessThan(COLD_AT)
    expect(
      run({ ...freshNeeds(), chill: 100 }, { night: 1, indoors: true }, 25).n.chill,
    ).toBeLessThan(COLD_AT)
  })

  test('sprain and food poisoning wear off', () => {
    const n = run({ ...freshNeeds(), sprain: 180, sick: 120 }, {}, 120).n
    expect(n.sick).toBe(0)
    expect(n.sprain).toBe(60)
  })
})

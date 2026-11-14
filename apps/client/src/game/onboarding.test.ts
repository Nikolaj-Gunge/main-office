import { describe, expect, test } from 'bun:test'
import { DAWN, DAY, freshJournal, makeBio, type SurvivalSelf } from '@office-fps/shared'
import { type HintContext, hintFor, hornVolume, isFullNotice, wantsCard } from './onboarding.ts'

const self = (o: Partial<SurvivalSelf> = {}): SurvivalSelf => ({
  inv: [],
  pack: null,
  wear: {},
  money: 0,
  hunger: 70,
  thirst: 70,
  bleeding: false,
  battery: 100,
  light: false,
  infected: null,
  journal: freshJournal(),
  ...o,
})

const ctx = (o: Partial<HintContext> = {}): HintContext => ({
  alive: true,
  self: self(),
  prompt: null,
  zombieNear: false,
  carNear: false,
  time: (DAY + 0.1) % 1,
  ...o,
})

describe('first-time hints', () => {
  test('each comes up when its moment does, once', () => {
    const none = new Set<string>()
    expect(hintFor(ctx(), none)).toBeNull()
    expect(hintFor(ctx({ prompt: 'Take Beans' }), none)).toBe('loot')
    expect(hintFor(ctx({ zombieNear: true }), none)).toBe('zombie')
    expect(hintFor(ctx({ time: 0.1 }), none)).toBe('night')
    expect(hintFor(ctx({ time: DAWN - 0.01 }), none)).toBe('night')
    expect(hintFor(ctx({ self: self({ infected: 300 }) }), none)).toBe('bite')
    expect(hintFor(ctx({ carNear: true }), none)).toBe('car')
    expect(hintFor(ctx({ self: self({ hunger: 20 }) }), none)).toBe('hungry')
    expect(hintFor(ctx({ prompt: 'Read the job board' }), none)).toBe('board')
    expect(hintFor(ctx({ prompt: 'Take Beans' }), new Set(['loot']))).toBeNull()
    // Nothing while dead.
    expect(hintFor(ctx({ alive: false, zombieNear: true }), none)).toBeNull()
  })

  test('the bite comes before everything else', () => {
    const c = ctx({ self: self({ infected: 300 }), zombieNear: true, prompt: 'Take Beans' })
    expect(hintFor(c, new Set())).toBe('bite')
  })

  test('"No room" from the server is the full-pockets moment', () => {
    expect(isFullNotice({ kind: 'warn', text: 'No room for it in your pockets or pack.' })).toBe(
      true,
    )
    expect(isFullNotice({ kind: 'info', text: 'Clean water.' })).toBe(false)
  })
})

describe('the character card', () => {
  test('once per new character, never for an old one', () => {
    const bio = makeBio(77, 1)
    expect(wantsCard(self({ bio, age: 3 }), null)).toEqual(bio)
    expect(wantsCard(self({ bio, age: 3 }), 77)).toBeNull()
    expect(wantsCard(self({ bio, age: 5000 }), null)).toBeNull()
    expect(wantsCard(self(), null)).toBeNull()
    expect(wantsCard(null, null)).toBeNull()
  })
})

describe('the dusk horn', () => {
  test('loud at Haven, quieter far away, but heard everywhere', () => {
    expect(hornVolume(0)).toBeGreaterThan(hornVolume(800))
    expect(hornVolume(800)).toBeGreaterThan(hornVolume(1600))
    expect(hornVolume(5000)).toBeGreaterThan(0.1)
  })
})

import { describe, expect, test } from 'bun:test'
import { type Legacy, makeBio, PICK_SECONDS, type SurvivalSelf } from '@office-fps/shared'
import { livesEntries } from './quest-journal.ts'
import { traitOptions, wantsPick } from './trait-pick.ts'

const legacy: Legacy = {
  lives: [
    {
      name: 'Walt Brandt',
      past: 'postal worker from Ashford',
      alive: 4000,
      kills: 52,
      cause: 'Taken by the dead',
      at: 0,
      look: 0,
      trait: 'steady',
    },
  ],
  traits: ['steady', 'handy'],
}
const self = (over: Partial<SurvivalSelf> = {}) =>
  ({ bio: makeBio(42, 0), age: 5, legacy, trait: 'steady', ...over }) as SurvivalSelf

describe('the legacy trait pick', () => {
  test('lists every earned trait, who left it, and a way to start clean', () => {
    const options = traitOptions(legacy)
    expect(options.map((o) => o.id)).toEqual(['steady', 'handy', null])
    expect(options[0]?.from).toBe('Walt Brandt put down 40 of the dead.')
    expect(options[1]?.from).toContain('Somebody before you')
    expect(traitOptions({ lives: [], traits: [] })).toEqual([])
  })

  test('shows once for a new character with something to pick', () => {
    expect(wantsPick(self(), legacy, null)).toBe(true)
    expect(wantsPick(self(), legacy, 42)).toBe(false)
    expect(wantsPick(self({ age: PICK_SECONDS }), legacy, null)).toBe(false)
    expect(wantsPick(self(), { lives: [], traits: [] }, null)).toBe(false)
  })

  test('the journal lists this life, the lives before and what they left', () => {
    const entries = livesEntries(self())
    expect(entries.map((e) => e.group)).toEqual([
      'Now',
      'Before you',
      'What they left',
      'What they left',
    ])
    expect(entries[1]?.label).toBe('Walt Brandt')
    expect(livesEntries(undefined)).toEqual([])
  })
})

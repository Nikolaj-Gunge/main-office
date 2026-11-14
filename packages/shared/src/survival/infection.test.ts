import { describe, expect, test } from 'bun:test'
import {
  INFECTION_SECONDS,
  infectionClock,
  infectionLeftText,
  infectionLevel,
  infectionStage,
  infectionWord,
} from './infection.ts'

const after = (minutes: number) => INFECTION_SECONDS - minutes * 60

describe('infection: how far along', () => {
  test('stages and the HUD word follow the time since the bite', () => {
    expect(infectionStage(null)).toBe(-1)
    expect(infectionWord(null)).toBe('')
    expect([0, 4.9, 5, 9.9, 10, 14.9, 15, 18.9, 19.5].map((m) => infectionWord(after(m)))).toEqual([
      'Bitten',
      'Bitten',
      'Feverish',
      'Feverish',
      'The shakes',
      'The shakes',
      'Turning',
      'Turning',
      'Turning',
    ])
    expect(infectionStage(after(15))).toBe(3)
    expect(infectionStage(60)).toBe(4)
    expect(infectionStage(1)).toBe(4)
  })

  test('the backpack says roughly how long is left, never to the second', () => {
    expect(infectionClock(null)).toBe('')
    expect(infectionClock(INFECTION_SECONDS)).toBe('20:00')
    expect(infectionClock(65.2)).toBe('1:06')
    expect(infectionClock(0)).toBe('0:00')
    expect(infectionLeftText(null)).toBe('')
    expect(infectionLeftText(INFECTION_SECONDS)).toBe('About 20 minutes left.')
    expect(infectionLeftText(after(8))).toBe('About 10 minutes left.')
    expect(infectionLeftText(after(14))).toBe('About 5 minutes left.')
    expect(infectionLeftText(150)).toBe('A few minutes left.')
    expect(infectionLeftText(30)).toBe('Any moment now.')
  })

  test('the screen shows nothing for ten minutes, then more and more, all of it at the end', () => {
    expect(infectionLevel(null)).toBe(0)
    expect(infectionLevel(after(9))).toBe(0)
    expect(infectionLevel(after(15))).toBeCloseTo(0.45)
    expect(infectionLevel(60)).toBeCloseTo(0.8)
    expect(infectionLevel(0)).toBeCloseTo(1)
    let last = 0
    for (let left = INFECTION_SECONDS; left >= 0; left -= 10) {
      const level = infectionLevel(left)
      expect(level).toBeGreaterThanOrEqual(last)
      last = level
    }
  })
})

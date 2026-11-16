import { describe, expect, test } from 'bun:test'
import { BOUNTY_BASE, BOUNTY_PER_DAY, BountyBoard } from './bounties.ts'
import { radioLine } from './radio.ts'

describe('new bounties on the radio', () => {
  test('a slip is read out once, on its first day; an old slip after a restart is not', () => {
    const board = new BountyBoard()
    const ann = { name: 'Ann', place: 'the chapel', reward: BOUNTY_BASE }
    expect(board.posted([ann])).toEqual([ann])
    expect(board.posted([ann])).toEqual([])
    // A day later it has grown: still not news.
    expect(board.posted([{ ...ann, reward: BOUNTY_BASE + BOUNTY_PER_DAY }])).toEqual([])
    // Put down, then somebody new of the same name turns: told again.
    expect(board.posted([])).toEqual([])
    expect(board.posted([ann])).toEqual([ann])
    // Long up already when the server starts: the board just has it.
    const fresh = new BountyBoard()
    expect(fresh.posted([{ ...ann, reward: BOUNTY_BASE + BOUNTY_PER_DAY * 3 }])).toEqual([])
  })

  test('Wes reads it out with the name, the place and the reward', () => {
    const e = { kind: 'wanted' as const, who: 'Ann', place: 'the chapel', reward: 60 }
    for (const r of [0, 0.99]) {
      const { text } = radioLine(e, () => r)
      expect(text).toContain('Ann')
      expect(text).toContain('the chapel')
      expect(text).toContain('60')
      expect(text).not.toContain('{')
    }
  })
})

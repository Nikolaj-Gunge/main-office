import { describe, expect, test } from 'bun:test'
import { DAY_SECONDS } from '@office-fps/shared'
import { postcardLines } from './keepsakes.ts'

describe('death postcard', () => {
  test('her name, past, days, kills and how', () => {
    const t = postcardLines({
      name: 'Ellen Voss',
      past: 'postal worker from Ashford',
      alive: DAY_SECONDS * 2.5,
      kills: 14,
      cause: 'Taken by the dead',
      body: 1,
    })
    expect(t.headline).toBe('THIS IS HOW THEY DIED.')
    expect(t.name).toBe('ELLEN VOSS')
    expect(t.past).toBe('Postal worker from Ashford.')
    expect(t.facts).toBe('Survived 2 days · 14 dead put down · Taken by the dead')
  })

  test('turned, one kill, no past', () => {
    const t = postcardLines({ name: 'Mo', past: '', alive: 10, kills: 1, cause: 'Turned', body: 0 })
    expect(t.headline).toBe('THIS IS HOW THEY TURNED.')
    expect(t.past).toBe('')
    expect(t.facts).toBe('Survived less than an hour · 1 dead put down · Turned')
  })
})

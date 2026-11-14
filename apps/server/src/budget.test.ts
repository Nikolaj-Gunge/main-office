import { describe, expect, test } from 'bun:test'
import { addCounts, FREE_REQUEST_LIMIT, limitFromEnv, RequestBudget } from './budget.ts'

const DAY = Date.UTC(2026, 10, 14, 12)

describe('RequestBudget', () => {
  test('20 incoming messages make one request; HTTP requests count one each', () => {
    const budget = new RequestBudget(FREE_REQUEST_LIMIT, () => DAY)
    budget.message(400)
    budget.http(5)
    expect(budget.snapshot()).toEqual({
      day: '2026-11-14',
      messages: 400,
      http: 5,
      usedToday: 25,
      freeLimit: 100_000,
      pct: 0,
      resting: false,
    })
  })

  test('rests at 95% of the limit, and the count resets at midnight UTC', () => {
    let now = DAY
    const budget = new RequestBudget(1000, () => now)
    budget.http(940)
    expect(budget.resting).toBe(false)
    budget.message(9 * 20)
    expect(budget.snapshot()).toMatchObject({ usedToday: 949, pct: 94.9, resting: false })
    budget.message(20)
    expect(budget.resting).toBe(true)
    now = Date.UTC(2026, 10, 15, 0, 0, 1)
    expect(budget.snapshot()).toMatchObject({ day: '2026-11-15', usedToday: 0, resting: false })
  })

  test('limit 0 (paid plan) never rests', () => {
    const budget = new RequestBudget(0, () => DAY)
    budget.http(10_000_000)
    expect(budget.resting).toBe(false)
    expect(budget.snapshot().pct).toBe(0)
  })

  test('FREE_REQUEST_LIMIT from the environment', () => {
    expect(limitFromEnv(undefined)).toBe(100_000)
    expect(limitFromEnv('')).toBe(100_000)
    expect(limitFromEnv('0')).toBe(0)
    expect(limitFromEnv('1000000')).toBe(1_000_000)
    expect(limitFromEnv('lots')).toBe(100_000)
  })

  test('syncs with the stored total: restore on start, then add only what is new', () => {
    let stored = { day: '2026-11-14', messages: 2000, http: 10 } // an earlier room's count
    const budget = new RequestBudget(1000, () => DAY)
    budget.synced(stored)
    expect(budget.usedToday).toBe(110)

    budget.message(200)
    const sent = budget.unsynced()
    expect(sent).toEqual({ day: '2026-11-14', messages: 200, http: 0 })
    budget.message(20) // arrives while the sync is under way
    stored = addCounts(stored, sent ?? stored)
    budget.synced(stored, sent ?? undefined)
    expect(stored).toEqual({ day: '2026-11-14', messages: 2200, http: 10 })
    expect(budget.unsynced()).toEqual({ day: '2026-11-14', messages: 20, http: 0 })
    expect(budget.usedToday).toBe(10 + 2220 / 20)
  })

  test("yesterday's stored count is ignored", () => {
    const budget = new RequestBudget(1000, () => DAY)
    budget.synced({ day: '2026-11-13', messages: 1e6, http: 1e6 })
    expect(budget.usedToday).toBe(0)
    expect(
      addCounts(
        { day: '2026-11-13', messages: 5, http: 5 },
        { day: '2026-11-14', messages: 1, http: 1 },
      ),
    ).toEqual({ day: '2026-11-14', messages: 1, http: 1 })
  })
})

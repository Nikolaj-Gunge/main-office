import { describe, expect, test } from 'bun:test'
import {
  ACHIEVEMENTS,
  CHALLENGES,
  COSMETICS,
  cleanNotes,
  dressedLooks,
  freshNotes,
  isoWeek,
  NOTES_PER_WEEK,
  recordNote,
  wearCosmetic,
  weekIndex,
  weekNotes,
} from './field-notes.ts'

const at = (iso: string) => Date.parse(iso)
const DAY = 86_400_000

describe('field notes: weeks', () => {
  test('ISO week numbers, including the ones that cross a new year', () => {
    expect(isoWeek(at('2026-11-15T12:00:00Z'))).toEqual({ year: 2026, week: 46 })
    expect(isoWeek(at('2026-11-16T00:00:00Z'))).toEqual({ year: 2026, week: 47 })
    expect(isoWeek(at('2021-01-03T10:00:00Z'))).toEqual({ year: 2020, week: 53 })
    expect(isoWeek(at('2024-12-30T10:00:00Z'))).toEqual({ year: 2025, week: 1 })
    expect(isoWeek(at('2026-01-01T10:00:00Z'))).toEqual({ year: 2026, week: 1 })
  })

  test('a week runs Monday to Sunday: the index changes on Monday at midnight UTC', () => {
    const monday = at('2026-11-09T00:00:00Z')
    expect(weekIndex(monday)).toBe(weekIndex(monday + 7 * DAY - 1))
    expect(weekIndex(monday + 7 * DAY)).toBe(weekIndex(monday) + 1)
    expect(weekIndex(monday - 1)).toBe(weekIndex(monday) - 1)
  })

  test('seven different notes, the same for everybody all week, others the next', () => {
    const w = weekIndex(at('2026-11-12T08:00:00Z'))
    const notes = weekNotes(w)
    expect(notes).toHaveLength(NOTES_PER_WEEK)
    expect(new Set(notes.map((n) => n.id)).size).toBe(NOTES_PER_WEEK)
    for (const n of notes) expect(CHALLENGES.some((c) => c.id === n.id)).toBe(true)
    expect(weekNotes(w)).toEqual(notes)
    const later = Array.from({ length: 6 }, (_, i) => weekNotes(w + 1 + i).map((n) => n.id))
    expect(later.some((ids) => ids.join() !== notes.map((n) => n.id).join())).toBe(true)
  })

  test('rewards are cosmetics only, a mix each week, and they come round again', () => {
    const w = 2900
    const ids = weekNotes(w).map((n) => n.reward.id)
    expect(new Set(ids).size).toBe(NOTES_PER_WEEK)
    expect(new Set(weekNotes(w).map((n) => n.reward.kind)).size).toBeGreaterThanOrEqual(3)
    const cycle = COSMETICS.length / NOTES_PER_WEEK
    expect(weekNotes(w + cycle).map((n) => n.reward.id)).toEqual(ids)
    // Every cosmetic is paid by some week within one cycle.
    const paid = new Set<string>()
    for (let i = 0; i < cycle; i++) for (const n of weekNotes(w + i)) paid.add(n.reward.id)
    expect(paid.size).toBe(COSMETICS.length)
  })
})

describe('field notes: progress', () => {
  const monday = at('2026-11-09T09:00:00Z')

  test('progress banks over the week (any day, no streak) and pays its cosmetic', () => {
    const notes = freshNotes(monday)
    const note = weekNotes(notes.week).find((n) => n.need > 1)
    if (!note) throw new Error('a week with a counted note')
    recordNote(notes, note.event, note.need - 1, monday)
    expect(notes.progress[note.id]).toBe(note.need - 1)
    // Three days off, then the last one on Friday.
    const done = recordNote(notes, note.event, 1, monday + 4 * DAY)
    expect(done.notes.map((n) => n.id)).toContain(note.id)
    expect(notes.done).toContain(note.id)
    expect(notes.owned).toContain(note.reward.id)
    // Done is done: more of it pays nothing again.
    expect(recordNote(notes, note.event, 5, monday + 5 * DAY).notes).toHaveLength(0)
  })

  test('a new week starts the notes over but keeps what was earned', () => {
    const notes = freshNotes(monday)
    const note = weekNotes(notes.week)[0]
    if (!note) throw new Error('no notes')
    recordNote(notes, note.event, note.need, monday)
    expect(notes.owned).toHaveLength(1)
    recordNote(notes, 'eat', 1, monday + 7 * DAY)
    expect(notes.week).toBe(weekIndex(monday) + 1)
    expect(notes.done).toEqual([])
    expect(notes.owned).toHaveLength(1)
  })

  test('all seven in a week fills every page', () => {
    const notes = freshNotes(monday)
    for (const n of weekNotes(notes.week)) recordNote(notes, n.event, n.need, monday)
    expect(notes.done).toHaveLength(NOTES_PER_WEEK)
    expect(notes.stats.week_full).toBe(1)
    expect(notes.got.map(([id]) => id)).toContain('every_page')
  })
})

describe('survival journal: achievements', () => {
  const now = at('2026-11-15T12:00:00Z')

  test('they trigger once, when the story happens', () => {
    const notes = freshNotes(now)
    expect(recordNote(notes, 'cure', 1, now).achievements.map((a) => a.id)).toEqual([
      'bitten_cured',
    ])
    expect(recordNote(notes, 'cure', 1, now).achievements).toHaveLength(0)
    expect(recordNote(notes, 'rescue', 1, now).achievements[0]?.title).toBe(
      'Carried a stranger home',
    )
    expect(recordNote(notes, 'dawn', 1, now).achievements[0]?.id).toBe('first_night')
    expect(recordNote(notes, 'rest_fire', 1, now).achievements[0]?.id).toBe('fed_by_fire')
  })

  test('counted ones wait for the count', () => {
    const notes = freshNotes(now)
    recordNote(notes, 'kill_knife', 9, now)
    expect(notes.got.some(([id]) => id === 'close_work')).toBe(false)
    recordNote(notes, 'kill_knife', 1, now)
    expect(notes.got.some(([id]) => id === 'close_work')).toBe(true)
    recordNote(notes, 'drive_m', 9_999, now)
    expect(notes.got.some(([id]) => id === 'long_road')).toBe(false)
    recordNote(notes, 'drive_m', 1, now)
    expect(notes.got.some(([id]) => id === 'long_road')).toBe(true)
  })

  test('there are about fifteen, each with a story', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(15)
    for (const a of ACHIEVEMENTS) expect(a.story.length).toBeGreaterThan(10)
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length)
  })
})

describe('cosmetics', () => {
  const now = at('2026-11-15T12:00:00Z')

  test('only what you own can be worn, in its own slot', () => {
    const notes = freshNotes(now)
    expect(wearCosmetic(notes, 'hat', 'hat_trapper')).toBe(false)
    notes.owned.push('hat_trapper', 'wrap_rust')
    expect(wearCosmetic(notes, 'jacket', 'hat_trapper')).toBe(false)
    expect(wearCosmetic(notes, 'hat', 'hat_trapper')).toBe(true)
    expect(wearCosmetic(notes, 'wrap', 'wrap_rust')).toBe(true)
    expect(notes.wear).toEqual({ hat: 'hat_trapper', wrap: 'wrap_rust' })
    expect(wearCosmetic(notes, 'hat', null)).toBe(true)
    expect(notes.wear.hat).toBeUndefined()
  })

  test('a hat and a jacket show over what is worn; legs and feet stay', () => {
    const gear = 4 | (5 << 4) | (2 << 8) | (3 << 12) // helmet, military vest, cargo, boots
    expect(dressedLooks(gear, {})).toBe(gear)
    const dressed = dressedLooks(gear, { hat: 'hat_ranger', jacket: 'jacket_parka' })
    expect(dressed & 15).toBe(10)
    expect((dressed >> 4) & 15).toBe(9)
    expect(dressed >> 8).toBe(gear >> 8)
  })

  test('a stored record is cleaned: unknown cosmetics, junk and unowned wear are dropped', () => {
    const notes = cleanNotes(
      {
        week: weekIndex(now),
        owned: ['hat_trapper', 'gold_crown', 7],
        wear: { hat: 'hat_trapper', jacket: 'jacket_parka' },
        stats: { kill: 4, nonsense: 9, dawn: 'x' },
        got: [['first_kill', 1], ['made_up', 2], 'junk'],
        progress: { knife: 2, bad: 'x' },
      },
      now,
    )
    expect(notes.owned).toEqual(['hat_trapper'])
    expect(notes.wear).toEqual({ hat: 'hat_trapper' })
    expect(notes.stats).toEqual({ kill: 4 })
    expect(notes.got).toEqual([['first_kill', 1]])
    expect(notes.progress).toEqual({ knife: 2 })
    expect(cleanNotes('garbage', now)).toEqual(freshNotes(now))
  })
})

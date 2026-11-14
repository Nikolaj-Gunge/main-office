import { describe, expect, test } from 'bun:test'
import {
  buildDeadwood,
  freshJournal,
  openJobs,
  questById,
  type SurvivalDef,
} from '@office-fps/shared'
import { fallbackStep } from './next-step.ts'

const def = buildDeadwood().survival as SurvivalDef

describe('always one next step', () => {
  test('a main quest with a target needs no fallback', () => {
    const j = freshJournal()
    j.quests.push({ id: 'wake', step: 0, count: 0 })
    expect(fallbackStep(def, j)).toBeNull()
  })

  test('between chapters, with jobs open: the job board, and where it is', () => {
    const j = freshJournal()
    j.done.push('wake', 'keep')
    expect(openJobs(j).length).toBeGreaterThan(0)
    const next = fallbackStep(def, j)
    expect(next?.text).toContain('job board')
    const board = def.interactables.find((t) => t.kind === 'board')
    expect(next?.at).toEqual(board?.pos ?? null)
  })

  test('a step waiting on a clue not found yet gets a fallback too', () => {
    const j = freshJournal()
    j.done.push('wake', 'keep')
    // Find a story step with a clue and stand on it without the clue.
    const story = ['gate', 'tower', 'voss', 'nell', 'site7', 'lastlight']
    let found = false
    for (const id of story) {
      j.quests = []
      const i = questById(id)?.steps.findIndex((s) => s.clue) ?? -1
      if (i < 0) continue
      j.quests.push({ id, step: i, count: 0 })
      expect(fallbackStep(def, j)).not.toBeNull()
      found = true
      break
    }
    expect(found).toBe(true)
  })

  test('nothing left on the board: ask around Haven', () => {
    const j = freshJournal()
    for (let k = 0; k < 8; k++) j.done.push(...openJobs(j).map((d) => d.id))
    j.done.push('lastlight')
    const next = fallbackStep(def, j)
    expect(next?.text).toContain('Haven')
    const haven = def.pois.find((p) => p.key === 'haven')
    expect(next?.at?.[0]).toBe(haven?.x)
  })
})

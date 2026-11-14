import {
  type Journal,
  openJobs,
  questById,
  type SurvivalDef,
  stepGoal,
  type Vec3,
  type WalkerState,
} from '@office-fps/shared'

/**
 * Always one next step (ROADMAP 2.4): when the story gives the tracker nothing to point at
 * (between chapters, a clue not found yet, or the story over), what to do instead. Null when the
 * main quest has a target of its own.
 */
export interface Fallback {
  text: string
  /** Where it points (the job board, or Haven's fire), or null. */
  at: Vec3 | null
}

export function fallbackStep(
  def: SurvivalDef,
  journal: Journal,
  walkers: readonly WalkerState[] = [],
  meId = 0,
): Fallback | null {
  const story = journal.quests.find((q) => questById(q.id)?.story)
  const step = story && questById(story.id)?.steps[story.step]
  if (story && step) {
    const goal = stepGoal(def, step, story, journal, walkers, meId)
    if (!goal.hidden && goal.points.length > 0) return null
  }
  const board = def.interactables.find((t) => t.kind === 'board')?.pos ?? null
  const haven = def.pois.find((p) => p.key === 'haven')
  const fire: Vec3 | null = haven ? [haven.x, haven.y, haven.z] : null
  const jobs = openJobs(journal).length
  if (jobs > 0 && board)
    return {
      text: `Check the job board inside Haven's gate (${jobs} job${jobs > 1 ? 's' : ''} up)`,
      at: board,
    }
  return { text: 'Ask around Haven: somebody always needs something', at: fire }
}

/**
 * Bounties on the long-lived turned: one of you who turned and has walked the woods a full world
 * day or more gets a slip on Haven's job board — their name, where they were last seen, and a
 * reward that grows every day they stay up. Whoever puts them down is paid (director.ts), Radio
 * Free Deadwood says so, and it goes in the Dawn Report.
 */

/** World days a turned has to walk before Haven posts a bounty. */
export const BOUNTY_DAYS = 1
/** The reward when it goes up, what it grows by each further day, and its most. */
export const BOUNTY_BASE = 60
export const BOUNTY_PER_DAY = 40
export const BOUNTY_MAX = 400

/** What putting down somebody who turned on day `since` is worth on day `day` (0: no bounty). */
export function bountyReward(since: number | undefined, day: number): number {
  if (since === undefined || !Number.isFinite(since)) return 0
  const walked = Math.floor(day - since)
  if (walked < BOUNTY_DAYS) return 0
  return Math.min(BOUNTY_MAX, BOUNTY_BASE + (walked - BOUNTY_DAYS) * BOUNTY_PER_DAY)
}

export interface Wanted {
  name: string
  /** Where they were last seen (a place name). */
  place: string
  reward: number
}

/** The board's slips for the wanted, the biggest reward first. */
export function wantedLines(wanted: readonly Wanted[]): string[] {
  return [...wanted]
    .sort((a, b) => b.reward - a.reward || a.name.localeCompare(b.name))
    .slice(0, 4)
    .map(
      (w) =>
        `WANTED: put ${w.name} to rest. Last seen near ${w.place}. $${w.reward} to whoever does.`,
    )
}

/**
 * Which slips are new on the board, so Wes can read them out once: a slip counts as just posted
 * on its first day up (the reward still BOUNTY_BASE), and each name is told only once.
 */
export class BountyBoard {
  private readonly told = new Set<string>()

  /** The wanted not told about yet, now marked told; names no longer wanted are forgotten. */
  posted(wanted: readonly Wanted[]): Wanted[] {
    const names = new Set(wanted.map((w) => w.name))
    for (const name of this.told) if (!names.has(name)) this.told.delete(name)
    const fresh: Wanted[] = []
    for (const w of wanted) {
      if (this.told.has(w.name)) continue
      this.told.add(w.name)
      if (w.reward <= BOUNTY_BASE) fresh.push(w)
    }
    return fresh
  }
}

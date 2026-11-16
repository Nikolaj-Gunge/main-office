import { type RadioVoteReply, type RadioVotes, ROT_MOODS, type RotMood } from '@office-fps/shared'

/** Voters remembered per night at most: past this, new votes are turned away (memory bound). */
export const MOOD_VOTERS_MAX = 5000

const emptyTally = (): Record<RotMood, number> => ({ calm: 0, fog: 0, hunting: 0, choir: 0 })

/**
 * Streamer night (research 6.4): listeners on the /radio page vote on the coming night's Rot
 * mood. Off unless an admin turns it on for the world (in memory: a restart or an empty room
 * that gets evicted turns it off again). No accounts: a voter is their address (never saved),
 * once per night. At dusk the most-voted mood is the night's; a tie keeps the world's own
 * seeded mood if it's among the tied, or the first of them.
 */
export class MoodVote {
  on = false
  /** The night the votes are for. */
  private night = 0
  private tally = emptyTally()
  private readonly voters = new Set<string>()

  /** A vote from `voter` for night `night` (the coming one). */
  vote(voter: string, mood: unknown, night: number): RadioVoteReply {
    if (!this.on) return { ok: false, error: 'off' }
    if (typeof mood !== 'string' || !ROT_MOODS.includes(mood as RotMood) || !voter)
      return { ok: false, error: 'bad' }
    if (night !== this.night) this.clear(night)
    if (this.voters.has(voter)) return { ok: false, error: 'voted', votes: this.votes() }
    if (this.voters.size >= MOOD_VOTERS_MAX) return { ok: false, error: 'busy' }
    this.voters.add(voter)
    this.tally[mood as RotMood]++
    return { ok: true, votes: this.votes() }
  }

  /** Has this voter had their say for that night? */
  voted(voter: string, night: number): boolean {
    return night === this.night && this.voters.has(voter)
  }

  /** The tally for the coming night (`night`), for the feed. */
  votes(night = this.night): RadioVotes {
    return { night, tally: night === this.night ? { ...this.tally } : emptyTally() }
  }

  /**
   * Dusk: the winning mood (null if off or nobody voted), and the box is emptied. `seeded` is
   * the mood the night would have had; it wins ties it's part of.
   */
  close(seeded: RotMood | null): RotMood | null {
    if (!this.on) return null
    const best = Math.max(...ROT_MOODS.map((m) => this.tally[m]))
    const winner =
      best === 0
        ? null
        : seeded && this.tally[seeded] === best
          ? seeded
          : (ROT_MOODS.find((m) => this.tally[m] === best) ?? null)
    this.clear(this.night + 1)
    return winner
  }

  setOn(on: boolean): void {
    this.on = on
    if (!on) this.clear(this.night)
  }

  private clear(night: number): void {
    this.night = night
    this.tally = emptyTally()
    this.voters.clear()
  }
}

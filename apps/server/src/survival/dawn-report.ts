import {
  cleanDawnReport,
  composeDawnReport,
  type DawnReport,
  emptyNight,
  type NightLog,
  quietNight,
  type RotMood,
} from '@office-fps/shared'

/**
 * The Dawn Report on the server (shared dawn-report.ts writes it): keeps the night's log as it
 * happens, writes it up at dawn, keeps the last one for Haven's job board and remembers who has
 * read it. Saved with the world: how many nights it has seen, and the last report.
 */
export class DawnDesk {
  private log: NightLog = emptyNight()
  /** Nights seen through to dawn (the current one is nights + 1). */
  nights = 0
  /** The last night's report, pinned to the board. */
  report: DawnReport | null = null
  /** Who has read the pinned report (player ids). */
  private readonly read = new Set<number>()

  /** The night it is now (1 = the world's first). */
  get night(): number {
    return this.nights + 1
  }

  /** A new world: no nights, no report. */
  reset(): void {
    this.log = emptyNight()
    this.nights = 0
    this.report = null
    this.read.clear()
  }

  /** As the world was saved (older saves have neither). */
  restore(nights: unknown, report: unknown): void {
    this.nights = Math.max(0, Math.floor(Number(nights) || 0))
    this.report = cleanDawnReport(report)
    this.read.clear()
  }

  /** Somebody was out there tonight. */
  seen(name: string): void {
    if (!this.log.present.includes(name) && this.log.present.length < 64)
      this.log.present.push(name)
  }

  died(name: string, cause: string, turned: boolean): void {
    this.log.deaths.push({ name, cause, turned })
  }

  out(name: string): void {
    this.log.out.push(name)
  }

  /** One of the dead put down (`by`: who, if a person did it). */
  putDown(by: string | null): void {
    this.log.putDown++
    if (by) this.log.kills[by] = (this.log.kills[by] ?? 0) + 1
  }

  /** Somebody's turned self put down. */
  turnedDown(name: string, by: string | null): void {
    this.log.turnedDown.push({ name, by })
  }

  /**
   * Dawn: the night is written up (null if nothing happened and nobody saw it) and a new log
   * starts. The night counts either way.
   */
  dawn(world: string, mood: RotMood | null): DawnReport | null {
    const log = this.log
    this.log = emptyNight()
    const night = this.night
    this.nights++
    if (quietNight(log)) return null
    this.report = composeDawnReport(log, { world, night, mood })
    this.read.clear()
    return this.report
  }

  /** The pinned report, if this player hasn't read it yet (and now they have). */
  unread(playerId: number): DawnReport | null {
    if (!this.report || this.read.has(playerId)) return null
    this.read.add(playerId)
    return this.report
  }

  /** Marks the pinned report as read by somebody (they got it at dawn). */
  markRead(playerId: number): void {
    this.read.add(playerId)
  }

  forget(playerId: number): void {
    this.read.delete(playerId)
  }
}

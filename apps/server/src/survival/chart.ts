import {
  bitsToText,
  CHART_MILESTONES,
  type Chart,
  type ChartArea,
  chartArea,
  chartShare,
  mergeBits,
  type Notice,
  type Poi,
  readChart,
  revealAround,
  type SurvivalSelf,
  textToBits,
} from '@office-fps/shared'
import type { Saves } from '../saves.ts'

/** The account record's key for the faded old map (saves.ts AccountSave). */
export const CHART_KEY = 'chart'
/** How often a growing map is copied into the account's old map (s). */
const KEEP_EVERY = 60

/** What the cartographer needs of a survivor. */
export interface ChartSurvivor {
  player: {
    id: number
    account?: string | null
    state: { alive: boolean; pos: { x: number; z: number } }
  }
  self: SurvivalSelf
  dirty: boolean
}

export interface ChartHost {
  /** The game's saves (asked each time: the game swaps them in when it loads). */
  saves(): Saves
  /** The world's places (the map's POIs). */
  pois(): readonly Poi[]
  notice(sv: ChartSurvivor, kind: Notice['kind'], text: string): void
}

interface Entry {
  /** The chart object it was read from: a different one means a new character. */
  chart: Chart
  bits: Uint8Array
  /** The account's old map: every map its characters have drawn. */
  old: Uint8Array
  rev: number
  sent: number
  oldRev: number
  oldSent: number
  /** Seconds since the old map was last written into the account. */
  since: number
  /** The old map is behind the character's map. */
  behind: boolean
  /**
   * Just read: its first second's drawing waits for the next update they get anyway (a new
   * character has just been sent everything; no extra message for the map alone).
   */
  quiet: boolean
}

/**
 * The map you draw yourself (shared/survival/chart.ts): every second, the squares around each
 * living survivor go on their character's map, and places they walk into are inked. The map is
 * saved with the character; the account keeps the union of all its characters' maps (the faded
 * old map a new character starts with). Both go out only when they change.
 */
export class Cartographer {
  private readonly host: ChartHost
  private readonly entries = new Map<number, Entry>()
  /** The squares the "% drawn" counts (worked out from the places on first use). */
  private area: ChartArea | null = null

  constructor(host: ChartHost) {
    this.host = host
  }

  /** Their map: read on first sight, and again when they start over as somebody new. */
  of(sv: ChartSurvivor): Entry {
    let e = this.entries.get(sv.player.id)
    if (e && e.chart === sv.self.chart) return e
    if (e) {
      // A new character: what the last one drew goes into the old map first.
      mergeBits(e.old, e.bits)
      this.keepOld(sv, e)
      e.oldRev++
    }
    const chart = readChart(sv.self.chart)
    sv.self.chart = chart
    const old = e?.old ?? this.accountOld(sv)
    const bits = textToBits(chart.seen)
    mergeBits(old, bits)
    e = {
      chart,
      bits,
      old,
      rev: 1,
      sent: 0,
      oldRev: e ? e.oldRev : 1,
      oldSent: 0,
      since: 0,
      behind: false,
      quiet: true,
    }
    this.entries.set(sv.player.id, e)
    return e
  }

  private accountOld(sv: ChartSurvivor): Uint8Array {
    const account = sv.player.account
    const raw = account ? this.host.saves().account(account)[CHART_KEY] : undefined
    return textToBits((raw as { seen?: unknown } | undefined)?.seen)
  }

  /** Once a second: the map fills in around them, and places they stand in are inked. */
  second(sv: ChartSurvivor): void {
    const e = this.of(sv)
    if (!sv.player.state.alive) return
    const { x, z } = sv.player.state.pos
    this.area ??= chartArea(this.host.pois())
    const before = chartShare(e.bits, this.area)
    let changed = revealAround(e.bits, x, z) > 0
    for (const poi of this.host.pois()) {
      if (e.chart.inked.includes(poi.key)) continue
      if (Math.hypot(poi.x - x, poi.z - z) > poi.r + 6) continue
      e.chart.inked.push(poi.key)
      changed = true
    }
    if (changed) {
      e.chart.seen = bitsToText(e.bits)
      e.rev++
      e.behind = true
      if (!e.quiet) sv.dirty = true
      const after = chartShare(e.bits, this.area)
      const mark = CHART_MILESTONES.findLast((m) => before < m && after >= m)
      if (mark !== undefined)
        this.host.notice(
          sv,
          'quest',
          `Your map: ${Math.round(mark * 100)}% of Deadwood County drawn in.`,
        )
    }
    e.quiet = false
    if (e.behind && ++e.since >= KEEP_EVERY) this.keep(sv)
  }

  /** What goes out to them: the self, with the map and the old map only when changed. */
  outgoing(sv: ChartSurvivor, out: SurvivalSelf): SurvivalSelf {
    const e = this.entries.get(sv.player.id)
    if (!e || e.chart !== sv.self.chart) return out
    if (e.sent === e.rev) delete out.chart
    else e.sent = e.rev
    if (e.oldSent !== e.oldRev) {
      e.oldSent = e.oldRev
      out.oldChart = bitsToText(e.old)
    }
    return out
  }

  /** The character's map into the account's old map (written on the next flush). */
  keep(sv: ChartSurvivor): void {
    const e = this.entries.get(sv.player.id)
    if (!e) return
    mergeBits(e.old, e.bits)
    this.keepOld(sv, e)
  }

  private keepOld(sv: ChartSurvivor, e: Entry): void {
    e.since = 0
    e.behind = false
    const account = sv.player.account
    if (account) this.host.saves().putAccount(account, CHART_KEY, { seen: bitsToText(e.old) })
  }

  /** They left: the old map kept, and forgotten here. */
  forget(sv: ChartSurvivor): void {
    this.keep(sv)
    this.entries.delete(sv.player.id)
  }

  reset(): void {
    this.entries.clear()
  }
}

import type { RotMood } from './rot.ts'

/**
 * The Dawn Report: at dawn the server writes up the night that just ended for its world (who
 * died and how, who got out on the helicopter, how many of the dead were put down and by whom)
 * and pins it to Haven's job board. Everybody online gets it as a paper note, with a short
 * spoiler-free line to paste anywhere, Wordle-style:
 *   Deadwood 2 · Night 23 🌲🌫
 *   🟥🟥🟩
 *   2 lost, 1 got out, 41 dead put down
 */

/** The notice title the report travels under (a `note` notice, see protocol.ts Notice). */
export const DAWN_TITLE = 'The Dawn Report'

/** One night as the server saw it (apps/server/src/survival/dawn-report.ts keeps it). */
export interface NightLog {
  /** Who died (character names) and how (legacy.ts causeOfDeath); `turned`: rose again. */
  deaths: { name: string; cause: string; turned: boolean }[]
  /** Who got out on the evacuation helicopter. */
  out: string[]
  /** The dead put down tonight, by anybody. */
  putDown: number
  /** Put down, by who did it (character names). */
  kills: Record<string, number>
  /** The turned (somebody's dead self) put down: whose it was, and who did it. */
  turnedDown: { name: string; by: string | null }[]
  /** People who were out there at some point tonight (names). */
  present: string[]
}

export const emptyNight = (): NightLog => ({
  deaths: [],
  out: [],
  putDown: 0,
  kills: {},
  turnedDown: [],
  present: [],
})

/** A written-up night, as saved with the world and sent to players. */
export interface DawnReport {
  /** "Deadwood 2 · Night 23" */
  title: string
  night: number
  /** The page: one paragraph per line. */
  lines: string[]
  /** The short line to paste anywhere (the client adds the world's link). */
  share: string
}

const MOOD_LINE: Record<RotMood, string> = {
  calm: 'A quiet night. Too quiet to trust.',
  fog: 'Fog all night. You heard them before you saw them.',
  hunting: 'They were hunting last night, and they knew where to look.',
  choir: 'The Choir sang all night out in the trees.',
}

const MOOD_MARK: Record<RotMood, string> = {
  calm: '🌙',
  fog: '🌫',
  hunting: '🩸',
  choir: '🔔',
}

/** At most this many squares in the share line's strip. */
const STRIP_MAX = 10

const list = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** True when nothing worth writing up happened and nobody was there to see it. */
export function quietNight(log: NightLog): boolean {
  return (
    log.present.length === 0 && log.deaths.length === 0 && log.out.length === 0 && log.putDown === 0
  )
}

/** Writes the night up. */
export function composeDawnReport(
  log: NightLog,
  opts: { world: string; night: number; mood?: RotMood | null },
): DawnReport {
  const night = Math.max(1, Math.floor(opts.night))
  const title = `${opts.world} · Night ${night}`
  const lines: string[] = []
  if (opts.mood) lines.push(MOOD_LINE[opts.mood])

  // The dead first: that's what people want to know.
  if (log.deaths.length === 0) lines.push('Nobody died. Write that down somewhere.')
  else {
    lines.push(
      log.deaths.length === 1
        ? "One of us didn't see the sun:"
        : `${log.deaths.length} of us didn't see the sun:`,
    )
    for (const d of log.deaths.slice(0, 8)) lines.push(`  ${d.name}: ${d.cause.toLowerCase()}.`)
    if (log.deaths.length > 8) lines.push(`  …and ${log.deaths.length - 8} more.`)
  }
  if (log.out.length > 0)
    lines.push(`Got out on the helicopter: ${list(log.out)}. They live at Haven now.`)
  for (const t of log.turnedDown.slice(0, 3))
    lines.push(
      t.by
        ? `${t.by} put down what was left of ${t.name}.`
        : `What was left of ${t.name} was put down.`,
    )

  // The dead put down, and who did the most of it.
  const best = Object.entries(log.kills).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (log.putDown > 0)
    lines.push(
      `${log.putDown} of the dead put down${best && best[1] > 1 ? `, ${best[1]} of them by ${best[0]}` : ''}.`,
    )
  else lines.push('Nobody put any of the dead down. They are all still out there.')
  if (log.present.length > 0)
    lines.push(
      log.present.length === 1
        ? `${log.present[0]} was out there alone.`
        : `${log.present.length} people were out there.`,
    )

  // The paste-anywhere line: no names but the world's, so it spoils nothing.
  const lost = log.deaths.length
  const gotOut = log.out.length
  const strip = `${'🟥'.repeat(Math.min(lost, STRIP_MAX))}${'🟩'.repeat(Math.min(gotOut, Math.max(0, STRIP_MAX - lost)))}`
  const counts = [
    `${lost} lost`,
    ...(gotOut > 0 ? [`${gotOut} got out`] : []),
    `${log.putDown} dead put down`,
  ].join(', ')
  const mark = opts.mood ? MOOD_MARK[opts.mood] : '🧟'
  const share = [`${title} 🌲${mark}`, ...(strip ? [strip] : []), counts].join('\n')
  return { title, night, lines, share }
}

/** A saved report as it came back (null if it isn't one). */
export function cleanDawnReport(raw: unknown): DawnReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<DawnReport>
  if (typeof r.title !== 'string' || typeof r.share !== 'string' || !Array.isArray(r.lines))
    return null
  return {
    title: r.title,
    night: Math.max(1, Math.floor(Number(r.night) || 1)),
    lines: r.lines.filter((l): l is string => typeof l === 'string').slice(0, 30),
    share: r.share,
  }
}

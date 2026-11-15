import { CAMP_FOLK } from './camp-folk.ts'
import { DAWN, DUSK, NIGHTFALL } from './daytime.ts'
import type { Stack } from './protocol.ts'

/**
 * Haven as a place that lives or dies (apps/server/src/survival/camp.ts): Red Night, the siege
 * that comes every week; the camp's morale, shared by everybody; and graves.
 *
 * The world counts days from dawn to dawn. Every RED_NIGHT_EVERY days the dead mass and come for
 * Haven's gate in the night: a warning goes out the day before, a horn at dusk, and the sky goes
 * red. Holding till dawn (or killing every last one) is a win and Haven grows; letting them reach
 * the fire, or through the wall in numbers, is a loss and Haven shrinks.
 */

/** Days between one Red Night and the next. */
export const RED_NIGHT_EVERY = 7
/** Waves of the dead in a Red Night, seconds between them, and the most out at once. */
export const RED_WAVES = 6
export const RED_WAVE_GAP = 70
export const RED_MOST = 26
/** The camp's hp a Red Night starts with, and what each of the dead costs it (per second
 * inside the wall; once, at the fire). */
export const RED_HP = 100
export const RED_INSIDE = 2
export const RED_AT_FIRE = 20

/** The camp's mood, 0–100, and where a new world starts. */
export const MORALE_START = 55
/** What raises and lowers it. */
export const MORALE = {
  deliver: 2,
  rescue: 4,
  quest: 3,
  held: 15,
  fell: -20,
  grave: 6,
  donate: 3,
  /** Somebody died in or near Haven. */
  death: -4,
  /** Each dawn: the days wear on everyone. */
  day: -3,
} as const
/** Below this people start to leave; from this up Haven does well. */
export const MORALE_LOW = 25
export const MORALE_HIGH = 70
/** What one donation at the box is. */
export const DONATION = 25
/** How many of Haven's extra stalls and lamps (won by holding Red Nights) there can be. */
export const HAVEN_MAX_LEVEL = 3
/** Graves the world remembers (the oldest are lost to the grass), and stacks one can hold. */
export const MAX_GRAVES = 24
export const GRAVE_STASH = 3
/** How close you stand to a body, or a grave, to dig (m). */
export const DIG_REACH = 2.6
/** The item you dig with. */
export const SHOVEL = 'shovel'

/** Haven's things for the camp, in Haven's own coordinates (the camp is built unturned). */
export const MORALE_BOARD: [x: number, z: number] = [-4.6, -19.8]
export const DONATION_BOX: [x: number, z: number] = [-4.3, -18.1]
/** The tally banner, on the palisade just west of the gate. */
export const GATE_BANNER: [x: number, z: number] = [-5.4, -29.62]
export const MORALE_BOARD_KEY = 'haven_morale'
export const DONATION_BOX_KEY = 'haven_donations'

export type MoraleTier = 'low' | 'steady' | 'high'

export function moraleTier(m: number): MoraleTier {
  return m < MORALE_LOW ? 'low' : m >= MORALE_HIGH ? 'high' : 'steady'
}

/** One word for it, for the board and the journal. */
export function moraleWord(m: number): string {
  if (m < 12) return 'Breaking'
  if (m < MORALE_LOW) return 'Low'
  if (m < 45) return 'Uneasy'
  if (m < MORALE_HIGH) return 'Steady'
  if (m < 88) return 'Hopeful'
  return 'Proud'
}

/** What Haven's traders charge, against their usual prices. */
export function priceFactor(m: number): number {
  const t = moraleTier(m)
  return t === 'high' ? 0.85 : t === 'low' ? 1.25 : 1
}

/** What Lena charges to patch you up. */
export function healPrice(m: number): number {
  const t = moraleTier(m)
  return t === 'high' ? 20 : t === 'low' ? 60 : 40
}

/** What Gus carries besides his usual stock: a shovel always, and more when Haven is proud. */
export function campStock(m: number): [item: string, price: number][] {
  const out: [string, number][] = [[SHOVEL, 0]]
  if (moraleTier(m) === 'high') out.push(['barricadekit', 0], ['radio', 0], ['pack_hiking', 0])
  return out
}

/** Who leaves first when the camp gives up (the last of CAMP_FOLK first: the newest arrivals). */
export const LEAVE_ORDER: readonly string[] = CAMP_FOLK.map((f) => f.name).reverse()

/** The next of Haven's people to go, or null when there's nobody left who could. */
export function nextToLeave(gone: readonly string[]): string | null {
  return LEAVE_ORDER.find((n) => !gone.includes(n)) ?? null
}

/** Where the Red Night stands: tomorrow ('eve', and all of the day itself), at dusk, or now. */
export type RedPhase = 'eve' | 'dusk' | 'night'

/**
 * The Red Night's phase on world day `day` at clock time `t`, or null. A day runs dawn to dawn,
 * so the night belongs to the day before it: the night of day N runs from nightfall on day N
 * until dawn starts day N + 1.
 */
export function redPhase(day: number, nextRed: number, t: number): RedPhase | null {
  const u = ((t % 1) + 1) % 1
  if (day === nextRed - 1) return 'eve'
  if (day !== nextRed) return null
  if (u >= NIGHTFALL || u < DAWN) return 'night'
  if (u >= DUSK) return 'dusk'
  return 'eve'
}

/** Days from `day` until the next Red Night (0 on the day itself). */
export function daysToRed(day: number, nextRed: number): number {
  return Math.max(0, nextRed - day)
}

/** World days (dawn to dawn) passed between two readings of the continuous clock (in days). */
export function dawnsBetween(from: number, to: number): number {
  return Math.max(0, Math.floor(to - DAWN) - Math.floor(from - DAWN))
}

/** A grave as the world keeps it (WorldSave.camp.graves). */
export interface GraveSave {
  id: number
  name: string
  x: number
  y: number
  z: number
  yaw: number
  /** The account that dug it: only they dig the stash up again. */
  owner: string
  stash: Stack[]
  /** World day it was dug. */
  day: number
}

/** Somebody who left Haven, and why: walked out (low morale), or taken in a Red Night. */
export interface GoneFolk {
  name: string
  why: 'left' | 'taken'
  day: number
}

/** Haven's record (WorldSave.camp): absent in older saves, read through readCamp. */
export interface CampSave {
  /** World days since it all began (dawn to dawn). */
  day: number
  /** The day the next Red Night falls on. */
  nextRed: number
  wins: number
  losses: number
  morale: number
  /** Extra stalls and lamps won (0–HAVEN_MAX_LEVEL). */
  level: number
  /** The last Red Night was lost: a stall stands boarded up till the next is held. */
  shut: boolean
  gone: GoneFolk[]
  graves: GraveSave[]
  /** Next grave's id. */
  nextGrave: number
}

export const freshCamp = (): CampSave => ({
  day: 0,
  nextRed: RED_NIGHT_EVERY,
  wins: 0,
  losses: 0,
  morale: MORALE_START,
  level: 0,
  shut: false,
  gone: [],
  graves: [],
  nextGrave: 1,
})

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A saved camp record, read defensively (anything missing starts fresh). */
export function readCamp(raw: unknown): CampSave {
  const c = freshCamp()
  if (!raw || typeof raw !== 'object') return c
  const r = raw as Partial<CampSave>
  c.day = Math.max(0, Math.floor(num(r.day, 0)))
  c.nextRed = Math.max(c.day, Math.floor(num(r.nextRed, c.day + RED_NIGHT_EVERY)))
  c.wins = Math.max(0, Math.floor(num(r.wins, 0)))
  c.losses = Math.max(0, Math.floor(num(r.losses, 0)))
  c.morale = Math.max(0, Math.min(100, num(r.morale, MORALE_START)))
  c.level = Math.max(0, Math.min(HAVEN_MAX_LEVEL, Math.floor(num(r.level, 0))))
  c.shut = r.shut === true
  c.gone = Array.isArray(r.gone)
    ? r.gone.filter((g): g is GoneFolk => !!g && typeof g.name === 'string')
    : []
  c.graves = Array.isArray(r.graves)
    ? r.graves
        .filter((g): g is GraveSave => !!g && typeof g.name === 'string')
        .map((g) => ({ ...g, stash: Array.isArray(g.stash) ? g.stash : [] }))
    : []
  c.nextGrave = Math.max(num(r.nextGrave, 1), ...c.graves.map((g) => num(g.id, 0) + 1), 1)
  return c
}

/** A grave, as everybody sees it. */
export interface GraveShared {
  id: number
  name: string
  x: number
  y: number
  z: number
  yaw: number
  /** Something is buried with them. */
  stash?: boolean
}

/** Somebody lying where they fell, who could be buried ('' for a stranger). */
export interface RemainsShared {
  name: string
  x: number
  y: number
  z: number
}

/** Haven's state for everybody (SurvivalShared.camp). */
export interface CampShared {
  day: number
  /** Days to the next Red Night (0: it's today). */
  redIn: number
  /** The Red Night's phase now, or absent. */
  red?: RedPhase
  morale: number
  wins: number
  losses: number
  level: number
  shut?: boolean
  /** Names of Haven's people who are gone (they don't walk the camp any more). */
  gone: string[]
  graves: GraveShared[]
  /** Bodies lying about that could be buried (the prompt's business). */
  remains?: RemainsShared[]
}

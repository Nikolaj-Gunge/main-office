/**
 * Field Notes and the Survival Journal: things that belong to the player, not the character, so
 * dying doesn't take them (kept in the account record, saves.ts loadAccount/putAccount, under
 * `notes`).
 *
 * Field Notes: seven small challenges a week, the same for everybody (picked from the ISO week).
 * They bank: do them any day of the week, in any order; nothing is lost for missing a day. Each
 * pays one cosmetic (a hat, a jacket, a gun wrap or a camp banner) and nothing else. The
 * cosmetics come round in turn, so a week's things come back some weeks later.
 *
 * The Survival Journal: achievements that read like the stories they are ("Bitten but cured").
 *
 * Both run off the same events (NoteEvent), told by the server as they happen.
 */

import { BODY_LOOKS, HEAD_LOOKS } from './gear.ts'
import { seeded } from './noise.ts'

/** Something that happened, counted (once, or in metres for driving). */
export type NoteEvent =
  | 'kill'
  | 'kill_knife'
  | 'kill_night'
  | 'board'
  | 'board_day'
  | 'craft'
  | 'craft_bandage'
  | 'drive_m'
  | 'rest_fire'
  | 'sleep'
  | 'eat'
  | 'deliver'
  | 'rescue'
  | 'quest'
  | 'cure'
  | 'death'
  | 'dawn'
  | 'trade'
  /** Every one of a week's seven notes done (counted by recordNote itself). */
  | 'week_full'

export const NOTE_EVENTS: readonly NoteEvent[] = [
  'kill',
  'kill_knife',
  'kill_night',
  'board',
  'board_day',
  'craft',
  'craft_bandage',
  'drive_m',
  'rest_fire',
  'sleep',
  'eat',
  'deliver',
  'rescue',
  'quest',
  'cure',
  'death',
  'dawn',
  'trade',
  'week_full',
]

// --- Cosmetics -------------------------------------------------------------------------------

export type CosmeticKind = 'hat' | 'jacket' | 'wrap' | 'banner'
export const COSMETIC_KINDS: readonly CosmeticKind[] = ['hat', 'jacket', 'wrap', 'banner']

export interface Cosmetic {
  id: string
  kind: CosmeticKind
  name: string
  /** Hats and jackets: the head or body look shown instead of what's worn (gear.ts). */
  look?: number
  /** Gun wraps: the colour the gun takes on. Banners: the cloth. */
  tint?: number
  /** Banners: the mark sewn on, and its colour. */
  mark?: 'crow' | 'antler' | 'lantern' | 'hand' | 'pine'
  ink?: number
}

/** Head looks 8–12 and body looks 8–12 are cosmetics only (no item gives them). */
export const COSMETIC_HEAD = { trapper: 8, flatcap: 9, ranger: 10, bucket: 11, stripe: 12 } as const
export const COSMETIC_BODY = { hunter: 8, parka: 9, denim: 10, poncho: 11, quilted: 12 } as const

/**
 * Everything Field Notes can pay out, in the order the weeks hand them out (mixed, so a week
 * pays some of each). There are three weeks' worth: then they come round again.
 */
export const COSMETICS: readonly Cosmetic[] = [
  { id: 'hat_trapper', kind: 'hat', name: 'Trapper hat', look: COSMETIC_HEAD.trapper },
  { id: 'jacket_hunter', kind: 'jacket', name: 'Blaze hunting vest', look: COSMETIC_BODY.hunter },
  { id: 'wrap_rust', kind: 'wrap', name: 'Rust wrap', tint: 0x8a4a2a },
  {
    id: 'banner_crow',
    kind: 'banner',
    name: 'Crow banner',
    tint: 0x2a2a30,
    mark: 'crow',
    ink: 0xd8d0c0,
  },
  { id: 'wrap_bone', kind: 'wrap', name: 'Bone wrap', tint: 0xcfc4a8 },
  { id: 'hat_flatcap', kind: 'hat', name: 'Wool flat cap', look: COSMETIC_HEAD.flatcap },
  { id: 'jacket_parka', kind: 'jacket', name: 'Old parka', look: COSMETIC_BODY.parka },
  {
    id: 'banner_antler',
    kind: 'banner',
    name: 'Antler banner',
    tint: 0x5a3a22,
    mark: 'antler',
    ink: 0xe8dcc0,
  },
  { id: 'wrap_moss', kind: 'wrap', name: 'Moss wrap', tint: 0x4a5a32 },
  { id: 'hat_ranger', kind: 'hat', name: 'Ranger hat', look: COSMETIC_HEAD.ranger },
  { id: 'jacket_denim', kind: 'jacket', name: 'Denim jacket', look: COSMETIC_BODY.denim },
  {
    id: 'banner_lantern',
    kind: 'banner',
    name: 'Lantern banner',
    tint: 0x23304a,
    mark: 'lantern',
    ink: 0xf0c060,
  },
  { id: 'hat_bucket', kind: 'hat', name: 'Fishing hat', look: COSMETIC_HEAD.bucket },
  { id: 'wrap_blood', kind: 'wrap', name: 'Old blood wrap', tint: 0x5a1a1a },
  { id: 'jacket_poncho', kind: 'jacket', name: 'Poncho', look: COSMETIC_BODY.poncho },
  {
    id: 'banner_hand',
    kind: 'banner',
    name: 'Red hand banner',
    tint: 0xd8d0c0,
    mark: 'hand',
    ink: 0x8a1c1c,
  },
  { id: 'wrap_ash', kind: 'wrap', name: 'Ash wrap', tint: 0x7a7a74 },
  { id: 'hat_stripe', kind: 'hat', name: 'Striped knit cap', look: COSMETIC_HEAD.stripe },
  { id: 'jacket_quilted', kind: 'jacket', name: 'Quilted coat', look: COSMETIC_BODY.quilted },
  {
    id: 'banner_pine',
    kind: 'banner',
    name: 'Pine banner',
    tint: 0x2a4a32,
    mark: 'pine',
    ink: 0xd8d0c0,
  },
  { id: 'wrap_steel', kind: 'wrap', name: 'Blued steel wrap', tint: 0x2e3a4e },
]

export const cosmeticById = (id: string | undefined): Cosmetic | undefined =>
  id ? COSMETICS.find((c) => c.id === id) : undefined

// The cosmetic looks must not clash with the looks real gear has.
for (const look of Object.values(COSMETIC_HEAD))
  if ((Object.values(HEAD_LOOKS) as number[]).includes(look)) throw new Error('head look clash')
for (const look of Object.values(COSMETIC_BODY))
  if ((Object.values(BODY_LOOKS) as number[]).includes(look)) throw new Error('body look clash')

// --- Weeks -----------------------------------------------------------------------------------

const DAY_MS = 86_400_000

/** The ISO week of a moment (UTC): the year it belongs to and its number, 1–53. */
export function isoWeek(ms: number): { year: number; week: number } {
  const d = new Date(Math.floor(ms / DAY_MS) * DAY_MS)
  const day = (d.getUTCDay() + 6) % 7 // Monday 0 … Sunday 6
  // The week belongs to the year its Thursday is in.
  d.setUTCDate(d.getUTCDate() - day + 3)
  const year = d.getUTCFullYear()
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Day = (new Date(jan4).getUTCDay() + 6) % 7
  const week = 1 + Math.round((d.getTime() - (jan4 - (jan4Day - 3) * DAY_MS)) / (7 * DAY_MS))
  return { year, week }
}

/** Weeks (Monday to Sunday, UTC) since the one 1 January 1970 fell in: counts up forever. */
export function weekIndex(ms: number): number {
  // 1970-01-01 was a Thursday: its Monday was three days earlier.
  return Math.floor((Math.floor(ms / DAY_MS) + 3) / 7)
}

// --- Challenges ------------------------------------------------------------------------------

export interface ChallengeDef {
  id: string
  text: string
  event: NoteEvent
  need: number
}

/** What a week's notes are picked from. */
export const CHALLENGES: readonly ChallengeDef[] = [
  { id: 'board_day', text: 'Board up a house before dusk (3 planks)', event: 'board_day', need: 3 },
  { id: 'knife', text: 'Kill 3 of the dead with a knife', event: 'kill_knife', need: 3 },
  { id: 'bandages', text: 'Craft 2 bandages', event: 'craft_bandage', need: 2 },
  { id: 'drive', text: 'Drive 2 km', event: 'drive_m', need: 2000 },
  { id: 'fire', text: 'Rest at the bonfire', event: 'rest_fire', need: 1 },
  { id: 'deliver', text: 'Deliver a quest item', event: 'deliver', need: 1 },
  { id: 'cull', text: 'Put down 15 of the dead', event: 'kill', need: 15 },
  { id: 'night', text: 'Kill 5 of the dead after dark', event: 'kill_night', need: 5 },
  { id: 'sleep', text: 'Sleep through a night in a bed', event: 'sleep', need: 1 },
  { id: 'eat', text: 'Eat or drink 4 times', event: 'eat', need: 4 },
  { id: 'make', text: 'Make 3 things', event: 'craft', need: 3 },
  { id: 'dawn', text: 'Be alive to see the sun come up', event: 'dawn', need: 1 },
  { id: 'rescue', text: 'Bring somebody home alive', event: 'rescue', need: 1 },
  { id: 'job', text: 'Finish a job for Haven', event: 'quest', need: 1 },
  { id: 'trade', text: 'Trade with Gus', event: 'trade', need: 1 },
]

export const NOTES_PER_WEEK = 7

/** A week's seven notes and what each pays (the same for everybody that week). */
export interface WeekNote extends ChallengeDef {
  reward: Cosmetic
}

/** The notes for a week (by weekIndex); the ISO week number seeds the pick. */
export function weekNotes(index: number): WeekNote[] {
  // The week's Thursday (day index × 7, see weekIndex) names it.
  const { year, week } = isoWeek(index * 7 * DAY_MS)
  const random = seeded(year * 100 + week)
  const pool = [...CHALLENGES]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j] as ChallengeDef, pool[i] as ChallengeDef]
  }
  return pool.slice(0, NOTES_PER_WEEK).map((c, i) => ({
    ...c,
    reward: COSMETICS[(index * NOTES_PER_WEEK + i) % COSMETICS.length] as Cosmetic,
  }))
}

// --- Achievements ----------------------------------------------------------------------------

export interface Achievement {
  id: string
  title: string
  /** How it went, said the way you'd tell it. */
  story: string
  stat: NoteEvent
  need: number
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first_night',
    title: 'First night survived',
    story: "The dark went on forever. Then it didn't.",
    stat: 'dawn',
    need: 1,
  },
  {
    id: 'bitten_cured',
    title: 'Bitten but cured',
    story: 'The fever had its hands round your throat. The serum pried them off.',
    stat: 'cure',
    need: 1,
  },
  {
    id: 'carried_home',
    title: 'Carried a stranger home',
    story: "You didn't know their name when you found them. You do now.",
    stat: 'rescue',
    need: 1,
  },
  {
    id: 'fed_by_fire',
    title: 'Fed by the fire',
    story: "Haven's fire, a tin plate, somebody else's stories. Enough.",
    stat: 'rest_fire',
    need: 1,
  },
  {
    id: 'first_kill',
    title: 'The first one',
    story: 'It used to be somebody. You try not to think about who.',
    stat: 'kill',
    need: 1,
  },
  {
    id: 'close_work',
    title: 'Close enough to smell it',
    story: "Ten of them, at arm's length, with a blade.",
    stat: 'kill_knife',
    need: 10,
  },
  {
    id: 'hundred',
    title: 'A hundred quiet graves',
    story: 'Nobody dug them. You count them anyway.',
    stat: 'kill',
    need: 100,
  },
  {
    id: 'nails',
    title: 'Nails in the dark',
    story: 'One plank across a window. It held long enough.',
    stat: 'board',
    need: 1,
  },
  {
    id: 'fortress',
    title: 'Nobody gets in',
    story: 'Thirty planks nailed up and the hammer worn smooth.',
    stat: 'board',
    need: 30,
  },
  {
    id: 'long_road',
    title: 'The long way round',
    story: 'Ten kilometres of dark road and a fuel gauge you stopped looking at.',
    stat: 'drive_m',
    need: 10_000,
  },
  {
    id: 'made_do',
    title: 'Made do',
    story: "Rags, string and stubbornness. Ten things that weren't there before.",
    stat: 'craft',
    need: 10,
  },
  {
    id: 'kept_word',
    title: 'Kept my word',
    story: 'Five times somebody asked. Five times you came back with it.',
    stat: 'deliver',
    need: 5,
  },
  {
    id: 'slept',
    title: 'Slept through it',
    story: 'You shut your eyes with them out there. You woke up.',
    stat: 'sleep',
    need: 1,
  },
  {
    id: 'somebody_else',
    title: 'Somebody else now',
    story: "One of you didn't make it. Somebody walked into Haven the next morning.",
    stat: 'death',
    need: 1,
  },
  {
    id: 'week',
    title: 'A week in the woods',
    story: 'Seven sunrises. Nobody promised you the eighth.',
    stat: 'dawn',
    need: 7,
  },
  {
    id: 'every_page',
    title: 'Every page filled',
    story: 'A week of Field Notes, all of them ticked off in pencil.',
    stat: 'week_full',
    need: 1,
  },
]

// --- The record ------------------------------------------------------------------------------

/** One player's Field Notes and journal (the account record's `notes`; SurvivalSelf.notes). */
export interface FieldNotes {
  /** The week (weekIndex) `progress` and `done` belong to. */
  week: number
  /** This week: challenge id → how far along. */
  progress: Record<string, number>
  /** This week: challenge ids finished. */
  done: string[]
  /** Cosmetic ids earned (kept for good). */
  owned: string[]
  /** What's worn of them, by kind. */
  wear: Partial<Record<CosmeticKind, string>>
  /** Everything counted, ever (by NoteEvent). */
  stats: Partial<Record<NoteEvent, number>>
  /** Achievements earned: id and when (ms). */
  got: [string, number][]
}

export const freshNotes = (now: number): FieldNotes => ({
  week: weekIndex(now),
  progress: {},
  done: [],
  owned: [],
  wear: {},
  stats: {},
  got: [],
})

/** A record read back from storage, made safe: unknown things are left out. */
export function cleanNotes(raw: unknown, now: number): FieldNotes {
  const out = freshNotes(now)
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Partial<FieldNotes>
  if (typeof r.week === 'number') out.week = r.week
  if (r.progress && typeof r.progress === 'object')
    for (const [k, v] of Object.entries(r.progress)) if (typeof v === 'number') out.progress[k] = v
  if (Array.isArray(r.done)) out.done = r.done.filter((d) => typeof d === 'string')
  if (Array.isArray(r.owned)) out.owned = r.owned.filter((id) => cosmeticById(id))
  if (r.wear && typeof r.wear === 'object')
    for (const kind of COSMETIC_KINDS) {
      const id = r.wear[kind]
      if (id && out.owned.includes(id) && cosmeticById(id)?.kind === kind) out.wear[kind] = id
    }
  if (r.stats && typeof r.stats === 'object')
    for (const e of NOTE_EVENTS) {
      const v = r.stats[e]
      if (typeof v === 'number' && Number.isFinite(v)) out.stats[e] = v
    }
  if (Array.isArray(r.got))
    out.got = r.got.filter(
      (g): g is [string, number] =>
        Array.isArray(g) && ACHIEVEMENTS.some((a) => a.id === g[0]) && typeof g[1] === 'number',
    )
  rollWeek(out, now)
  return out
}

/** A new week: last week's progress is put away (what it paid is kept). True if it rolled. */
export function rollWeek(notes: FieldNotes, now: number): boolean {
  const week = weekIndex(now)
  if (notes.week === week) return false
  notes.week = week
  notes.progress = {}
  notes.done = []
  return true
}

/** What one event finished. */
export interface NoteResult {
  notes: WeekNote[]
  achievements: Achievement[]
}

/** Counts `n` of an event: this week's notes move on, achievements are checked. */
export function recordNote(
  notes: FieldNotes,
  event: NoteEvent,
  n: number,
  now: number,
): NoteResult {
  const out: NoteResult = { notes: [], achievements: [] }
  if (!(n > 0)) return out
  rollWeek(notes, now)
  notes.stats[event] = (notes.stats[event] ?? 0) + n
  const week = weekNotes(notes.week)
  for (const note of week) {
    if (note.event !== event || notes.done.includes(note.id)) continue
    const at = Math.min(note.need, (notes.progress[note.id] ?? 0) + n)
    notes.progress[note.id] = at
    if (at < note.need) continue
    notes.done.push(note.id)
    if (!notes.owned.includes(note.reward.id)) notes.owned.push(note.reward.id)
    out.notes.push(note)
  }
  if (out.notes.length > 0 && notes.done.length === week.length)
    notes.stats.week_full = (notes.stats.week_full ?? 0) + 1
  for (const a of ACHIEVEMENTS) {
    if (notes.got.some(([id]) => id === a.id)) continue
    if ((notes.stats[a.stat] ?? 0) >= a.need) {
      notes.got.push([a.id, now])
      out.achievements.push(a)
    }
  }
  return out
}

/** Puts on (or, with null, takes off) an owned cosmetic; false if it can't be worn. */
export function wearCosmetic(notes: FieldNotes, kind: CosmeticKind, id: string | null): boolean {
  if (!COSMETIC_KINDS.includes(kind)) return false
  if (id === null) {
    delete notes.wear[kind]
    return true
  }
  const c = cosmeticById(id)
  if (!c || c.kind !== kind || !notes.owned.includes(id)) return false
  notes.wear[kind] = id
  return true
}

/**
 * What somebody wearing cosmetics looks like (gear.ts packing): a hat replaces the head look, a
 * jacket the body look. Legs and feet stay as worn.
 */
export function dressedLooks(gear: number, wear: FieldNotes['wear'] | undefined): number {
  const hat = cosmeticById(wear?.hat)?.look
  const jacket = cosmeticById(wear?.jacket)?.look
  let out = gear
  if (hat !== undefined) out = (out & ~0xf) | (hat & 15)
  if (jacket !== undefined) out = (out & ~0xf0) | ((jacket & 15) << 4)
  return out
}

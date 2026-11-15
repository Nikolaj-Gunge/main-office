import { HAIR_COLORS, SKIN_TONES, unpackAppearance } from '../appearance.ts'
import { DAY_SECONDS } from './daytime.ts'

/**
 * What outlives a character (ROADMAP 4.3–4.5). Dying loses the person, what they could do and
 * what they carried. The account keeps the Haven locker (storage.ts), a journal of past lives
 * and one small trait each of them earned by how they lived (4.4). The world keeps the
 * obituary wall in Haven, where anyone can leave flowers (4.5).
 */

/** What a character did with their life: counted as they go, read when they die. */
export interface LifeStats {
  /** The dead they put down. */
  kills: number
  /** Dawns they saw. */
  nights: number
  /** Metres walked (on foot). */
  walked: number
  /** Things made (crafting.ts recipes). */
  crafted: number
  /** Proper meals eaten. */
  meals: number
  /** Wounds bandaged and pills taken. */
  patched: number
}

export const freshLife = (): LifeStats => ({
  kills: 0,
  nights: 0,
  walked: 0,
  crafted: 0,
  meals: 0,
  patched: 0,
})

/** Counts one more of something on a character (life stats appear on first use). */
export function bumpLife(self: { life?: LifeStats }, stat: keyof LifeStats, by = 1): void {
  const life = self.life ?? freshLife()
  life[stat] = (life[stat] ?? 0) + by
  self.life = life
}

export type TraitId = 'steady' | 'nightowl' | 'longlegs' | 'handy' | 'stomach' | 'medic'

/** What a trait changes, as a factor on the usual (all small: 5–10%). */
export type TraitEffect = 'sway' | 'night' | 'stamina' | 'craft' | 'drain' | 'patch'

export interface TraitDef {
  id: TraitId
  name: string
  /** What it does, said plainly. */
  desc: string
  /** How a life earns it: this stat reaching `need`. */
  stat: keyof LifeStats
  need: number
  /** What the dead one did to earn it ("put down 40 of the dead"). */
  how: string
  effect: TraitEffect
  /** × the usual (below 1: less sway, less drain, faster). */
  factor: number
}

export const TRAITS: Record<TraitId, TraitDef> = {
  steady: {
    id: 'steady',
    name: 'Steady Hands',
    desc: 'Your aim drifts a little less.',
    stat: 'kills',
    need: 40,
    how: 'put down 40 of the dead',
    effect: 'sway',
    factor: 0.9,
  },
  nightowl: {
    id: 'nightowl',
    name: 'Night Owl',
    desc: 'Your eyes find a little more in the dark.',
    stat: 'nights',
    need: 5,
    how: 'saw 5 dawns',
    effect: 'night',
    factor: 1.1,
  },
  longlegs: {
    id: 'longlegs',
    name: 'Long Legs',
    desc: 'You run a little longer before your breath goes.',
    stat: 'walked',
    need: 10_000,
    how: 'walked 10 km',
    effect: 'stamina',
    factor: 0.92,
  },
  handy: {
    id: 'handy',
    name: 'Handy',
    desc: 'Making things takes a little less time.',
    stat: 'crafted',
    need: 20,
    how: 'made 20 things',
    effect: 'craft',
    factor: 0.9,
  },
  stomach: {
    id: 'stomach',
    name: 'Iron Stomach',
    desc: 'Hunger and thirst creep up a little slower.',
    stat: 'meals',
    need: 30,
    how: 'ate 30 proper meals',
    effect: 'drain',
    factor: 0.93,
  },
  medic: {
    id: 'medic',
    name: 'Field Medic',
    desc: 'Bandages and pills go on a little quicker.',
    stat: 'patched',
    need: 10,
    how: 'patched up 10 wounds',
    effect: 'patch',
    factor: 0.9,
  },
}

export const TRAIT_LIST: readonly TraitDef[] = Object.values(TRAITS)

export const isTrait = (id: unknown): id is TraitId =>
  typeof id === 'string' && Object.hasOwn(TRAITS, id)

/**
 * The trait a life earned: of the needs it met, the one it went furthest past (ties: the
 * first in TRAITS). Null if it met none.
 */
export function earnedTrait(life: LifeStats | undefined): TraitId | null {
  if (!life) return null
  let best: TraitDef | null = null
  let bestRatio = 1
  for (const t of TRAIT_LIST) {
    const ratio = (life[t.stat] ?? 0) / t.need
    if (ratio >= bestRatio && (!best || ratio > bestRatio)) {
      best = t
      bestRatio = ratio
    }
  }
  return best?.id ?? null
}

/** × the usual for `effect`, for somebody carrying `trait` (1 when it isn't theirs). */
export function traitFactor(trait: string | null | undefined, effect: TraitEffect): number {
  const t = isTrait(trait) ? TRAITS[trait] : undefined
  return t && t.effect === effect ? t.factor : 1
}

/** A new character can still change their trait this long (s alive). */
export const PICK_SECONDS = 300

// --- The journal of past lives (account) ---------------------------------------------------------

/** One character who died: kept on the account, shown in the journal. */
export interface PastLife {
  name: string
  /** "postal worker from Ashford". */
  past: string
  /** Seconds they were alive. */
  alive: number
  kills: number
  /** How they died ("Taken by the dead", "Turned"…). */
  cause: string
  /** When (ms since 1970). */
  at: number
  /** What they looked like (packed appearance), for the portrait. */
  look: number
  /** What they left behind (TRAITS), if anything. */
  trait: TraitId | null
}

/** The account's legacy: who came before, and the traits they left. */
export interface Legacy {
  /** Newest first. */
  lives: PastLife[]
  /** Every trait earned, newest first, each once. */
  traits: TraitId[]
}

/** Lives kept in the journal (the oldest are forgotten). */
export const MAX_LIVES = 40

/** A loose, possibly old or hand-edited legacy record, made safe to use. */
export function cleanLegacy(raw: unknown): Legacy {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Legacy>
  const lives = Array.isArray(r.lives)
    ? r.lives.filter((l): l is PastLife => !!l && typeof l.name === 'string')
    : []
  const traits = Array.isArray(r.traits) ? r.traits.filter(isTrait) : []
  return { lives: lives.slice(0, MAX_LIVES), traits: [...new Set(traits)] }
}

/** The legacy after a death: the life goes on top, its trait (if any) becomes the newest. */
export function recordLife(legacy: Legacy, life: PastLife): Legacy {
  const traits = life.trait
    ? [life.trait, ...legacy.traits.filter((t) => t !== life.trait)]
    : legacy.traits
  return { lives: [life, ...legacy.lives].slice(0, MAX_LIVES), traits }
}

// --- The obituary wall (world) ------------------------------------------------------------------

/** One name on the wall in Haven. */
export interface Obituary {
  name: string
  alive: number
  kills: number
  cause: string
  look: number
  at: number
  /** Flowers left for them. */
  flowers: number
}

/** Haven's obituary wall: the most recent dead of this world, newest first. */
export interface ObitWall {
  dead: Obituary[]
  /** Every flower ever left at the wall (the pile under it grows with them). */
  flowers: number
}

/** Names the wall has room for. */
export const WALL_NAMES = 10
/** One flower per character this often (s). */
export const FLOWER_SECONDS = 120

export const freshWall = (): ObitWall => ({ dead: [], flowers: 0 })

/** A saved wall (maybe missing or old), made safe. */
export function cleanWall(raw: unknown): ObitWall {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ObitWall>
  const dead = Array.isArray(r.dead)
    ? r.dead.filter((d): d is Obituary => !!d && typeof d.name === 'string')
    : []
  const flowers = typeof r.flowers === 'number' && r.flowers >= 0 ? Math.floor(r.flowers) : 0
  return { dead: dead.slice(0, WALL_NAMES), flowers }
}

/** The wall with a new name at the top (the oldest drops off). */
export function addObituary(wall: ObitWall, obit: Obituary): ObitWall {
  return { dead: [obit, ...wall.dead].slice(0, WALL_NAMES), flowers: wall.flowers }
}

/** Somebody leaves flowers: for the newest name (none yet: just at the foot of the wall). */
export function leaveFlowers(wall: ObitWall): ObitWall {
  const [first, ...rest] = wall.dead
  return {
    dead: first ? [{ ...first, flowers: first.flowers + 1 }, ...rest] : [],
    flowers: wall.flowers + 1,
  }
}

/** Flowers drawn in the pile under the wall (it grows slower as it gets big; capped). */
export function pileSize(flowers: number): number {
  if (flowers <= 0) return 0
  return Math.min(48, Math.round(4 * Math.sqrt(flowers)))
}

/** "3 days", "5 hours", "less than an hour": how long a character lasted (game time). */
export function survivedText(seconds: number): string {
  const days = seconds / DAY_SECONDS
  if (days >= 1) {
    const d = Math.floor(days)
    return `${d} day${d === 1 ? '' : 's'}`
  }
  const hours = Math.floor(days * 24)
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`
  return 'less than an hour'
}

/** A portrait's colours (CSS hex): skin and hair, from a packed appearance. */
export function portraitColours(look: number): { skin: string; hair: string } {
  const a = unpackAppearance(look)
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
  return {
    skin: hex(SKIN_TONES[a.skin] ?? SKIN_TONES[0]),
    hair: hex(
      a.hair === 0
        ? (SKIN_TONES[a.skin] ?? SKIN_TONES[0])
        : (HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0]),
    ),
  }
}

/**
 * Chalk marks (apps/server/src/survival/chalk.ts): a symbol and a couple of words from fixed
 * lists, chalked on whatever you look at (a wall, a tree, the road), left for whoever comes by.
 * Nobody types anything, so there is nothing to moderate. They are anonymous, they stay in the
 * world's save, and they wear off after a few days. Everyone has only so many on the go (a new
 * one rubs out their oldest), and the world keeps only so many (the oldest go first).
 */

/** The symbols, in order (ChalkMark.sym); each one's name for the picker. */
export const CHALK_SYMBOLS = [
  'Arrow',
  'Cross',
  'Circle',
  'Skull',
  'Tick',
  'Eye',
  'House',
  'Question',
] as const
/** The first word (ChalkMark.a; -1: none). */
export const CHALK_WORDS = [
  'Danger',
  'Safe',
  'Loot',
  'Trap',
  'Turn back',
  'Thank you',
  'Water',
  'Hide',
  'Friends',
  'The dead',
  'Help',
  'Was here',
] as const
/** The second word (ChalkMark.b; -1: none). */
export const CHALK_PLACES = [
  'ahead',
  'inside',
  'below',
  'behind',
  'left',
  'right',
  'here',
  'at night',
] as const

/** How far you reach to chalk (m). */
export const CHALK_REACH = 3
/** Marks one person has on the go, and the most a world keeps. */
export const CHALK_PER_PLAYER = 5
export const CHALK_PER_WORLD = 200
/** How long one lasts (ms of real time), and the last stretch over which it fades. */
export const CHALK_LIFE_MS = 3 * 24 * 3600 * 1000
export const CHALK_FADE_MS = 24 * 3600 * 1000
/** Seconds between two marks by the same hand. */
export const CHALK_COOLDOWN = 4

/** One mark, as everybody gets it (SurvivalSelf.chalk). Positions to 0.01 m; normal to 0.01. */
export interface ChalkMark {
  id: number
  x: number
  y: number
  z: number
  /** The surface's normal: the mark lies flat on it. */
  nx: number
  ny: number
  nz: number
  sym: number
  a: number
  b: number
  /** When it was chalked (ms since 1970): it fades with age. */
  at: number
}

/** The words of a mark ("Danger ahead"), or '' for just the symbol. */
export function chalkText(a: number, b: number): string {
  const first = CHALK_WORDS[a] ?? ''
  const second = CHALK_PLACES[b] ?? ''
  return [first, second].filter(Boolean).join(' ')
}

/** How much of a mark is still there, 1 (fresh) … 0 (gone), `now` in ms. */
export function chalkFade(at: number, now: number): number {
  const left = at + CHALK_LIFE_MS - now
  if (left <= 0) return 0
  return Math.min(1, left / CHALK_FADE_MS)
}

/** A mark's symbol and words checked against the lists; null if the symbol is no symbol. */
export function cleanChalk(
  sym: unknown,
  a: unknown,
  b: unknown,
): { sym: number; a: number; b: number } | null {
  const pick = (v: unknown, n: number) => {
    const i = Math.floor(Number(v))
    return Number.isFinite(i) && i >= 0 && i < n ? i : -1
  }
  const s = pick(sym, CHALK_SYMBOLS.length)
  if (s < 0) return null
  return { sym: s, a: pick(a, CHALK_WORDS.length), b: pick(b, CHALK_PLACES.length) }
}

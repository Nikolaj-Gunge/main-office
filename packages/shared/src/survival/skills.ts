/**
 * Learn-by-doing skills (ROADMAP 3.5). A character gets better at what they do: shooting and
 * hitting things, creeping past the dead, patching people and cars up, nailing planks, running.
 * Each skill has five levels; each level helps a little (a few per cent), and the fifth takes
 * hours of doing the thing. Skills belong to the character (SurvivalSelf.skills): a new one
 * starts with none. A field manual (an item, one per skill) read through triples what that skill
 * learns for half an hour.
 *
 * The server owns the experience; both sides read the levels for what they change (the client
 * predicts aim and running with them).
 */

export type SkillId = 'aim' | 'melee' | 'stealth' | 'medic' | 'mechanic' | 'carpentry' | 'fitness'

export const SKILL_IDS: readonly SkillId[] = [
  'aim',
  'melee',
  'stealth',
  'medic',
  'mechanic',
  'carpentry',
  'fitness',
]

export interface SkillInfo {
  name: string
  /** How it is learned. */
  learn: string
  /** What each level does, said short. */
  gives: string
  /** Its field manual's item id (items.ts). */
  manual: string
  /** The manual's cover (icons and models). */
  cover: string
}

export const SKILLS: Readonly<Record<SkillId, SkillInfo>> = {
  aim: {
    name: 'Aim',
    learn: 'Hit things with a gun.',
    gives: 'Less sway and kick, faster to the sights.',
    manual: 'manual_aim',
    cover: '#4a5a3a',
  },
  melee: {
    name: 'Melee',
    learn: 'Hit things with a blade or a club.',
    gives: 'Faster swings that land harder.',
    manual: 'manual_melee',
    cover: '#8a2a24',
  },
  stealth: {
    name: 'Stealth',
    learn: 'Move crouched near the dead before they notice you.',
    gives: 'Quieter steps; the dead see you from less far.',
    manual: 'manual_stealth',
    cover: '#2a2e38',
  },
  medic: {
    name: 'Medic',
    learn: 'Use bandages, pills and kits.',
    gives: 'Quicker to patch up, and it heals more.',
    manual: 'manual_medic',
    cover: '#e8e4dc',
  },
  mechanic: {
    name: 'Mechanic',
    learn: 'Fix cars.',
    gives: 'Faster repairs; the car you drive takes less damage.',
    manual: 'manual_mechanic',
    cover: '#2a4ab0',
  },
  carpentry: {
    name: 'Carpentry',
    learn: 'Nail planks up and make things out of them.',
    gives: 'Faster to nail and build; your barricades hold longer.',
    manual: 'manual_carpentry',
    cover: '#9a6a3c',
  },
  fitness: {
    name: 'Fitness',
    learn: 'Sprint.',
    gives: 'More breath for running.',
    manual: 'manual_fitness',
    cover: '#c8602a',
  },
}

export const MAX_SKILL_LEVEL = 5

/**
 * Experience to reach each level (index = level). Roughly an hour of steady use gets you to 2 or
 * 3; level 5 is a few hours of doing mostly that.
 */
export const SKILL_XP: readonly number[] = [0, 60, 180, 420, 800, 1400]

/** A field manual multiplies what its skill learns by this, for MANUAL_SECONDS. */
export const MANUAL_BOOST = 3
export const MANUAL_SECONDS = 30 * 60
/** Seconds it takes to read one. */
export const MANUAL_READ_SECONDS = 6

/** Experience for each thing done (see the server's skills.ts for where they happen). */
export const SKILL_GAIN = {
  /** A bullet (or pellet volley) into one of them. */
  gunHit: 2,
  /** A swing that connects. */
  meleeHit: 2.5,
  /** A second crouch-moving near one of the dead that hasn't seen you. */
  sneakSecond: 0.5,
  /** A med used, plus one per this many points of health it gives back. */
  medUse: 8,
  medPerHealth: 5,
  /** A car part fitted (or fuel poured in). */
  carFix: 25,
  /** A plank nailed up, a thing made with planks. */
  plank: 6,
  plankCraft: 10,
  /** Per metre sprinted. */
  sprintMetre: 0.12,
} as const

/** What a character knows (saved with them). */
export interface Skills {
  /** Experience so far, by skill (absent: none). */
  xp: Partial<Record<SkillId, number>>
  /** Seconds of a field manual's boost left, by skill (absent: none). */
  read?: Partial<Record<SkillId, number>>
}

export const freshSkills = (): Skills => ({ xp: {} })

/** A saved or sent skills record, made safe (unknown skills and junk numbers dropped). */
export function cleanSkills(raw: unknown): Skills {
  const out = freshSkills()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as { xp?: Record<string, unknown>; read?: Record<string, unknown> }
  for (const id of SKILL_IDS) {
    const xp = r.xp?.[id]
    if (typeof xp === 'number' && Number.isFinite(xp) && xp > 0)
      out.xp[id] = Math.min(xp, SKILL_XP[MAX_SKILL_LEVEL] as number)
    const left = r.read?.[id]
    if (typeof left === 'number' && Number.isFinite(left) && left > 0) {
      out.read ??= {}
      out.read[id] = Math.min(left, MANUAL_SECONDS)
    }
  }
  return out
}

/** The level that much experience is (0–5). */
export function levelFor(xp: number): number {
  let level = 0
  while (level < MAX_SKILL_LEVEL && xp >= (SKILL_XP[level + 1] as number)) level++
  return level
}

export function skillLevel(skills: Skills | undefined, id: SkillId): number {
  return levelFor(skills?.xp[id] ?? 0)
}

/** How far into its level a skill is: the level, and 0–1 of the way to the next (1 at max). */
export function skillProgress(
  skills: Skills | undefined,
  id: SkillId,
): { level: number; to: number } {
  const xp = skills?.xp[id] ?? 0
  const level = levelFor(xp)
  if (level >= MAX_SKILL_LEVEL) return { level, to: 1 }
  const from = SKILL_XP[level] as number
  const next = SKILL_XP[level + 1] as number
  return { level, to: (xp - from) / (next - from) }
}

/**
 * Adds experience to a skill (tripled while its manual is fresh). Returns the new level if it
 * went up, else null.
 */
export function gainSkill(skills: Skills, id: SkillId, amount: number): number | null {
  if (!(amount > 0)) return null
  const before = skills.xp[id] ?? 0
  const cap = SKILL_XP[MAX_SKILL_LEVEL] as number
  if (before >= cap) return null
  const boost = (skills.read?.[id] ?? 0) > 0 ? MANUAL_BOOST : 1
  const after = Math.min(cap, before + amount * boost)
  skills.xp[id] = after
  const was = levelFor(before)
  const now = levelFor(after)
  return now > was ? now : null
}

/** A field manual read: its skill learns faster for the next half hour. */
export function readManual(skills: Skills, id: SkillId): void {
  skills.read ??= {}
  skills.read[id] = MANUAL_SECONDS
}

/** Time passes for the manuals' boosts; true if one ran out. */
export function tickSkills(skills: Skills, dt: number): boolean {
  if (!skills.read) return false
  let ended = false
  for (const id of SKILL_IDS) {
    const left = skills.read[id]
    if (left === undefined) continue
    if (left - dt <= 0) {
      delete skills.read[id]
      ended = true
    } else skills.read[id] = left - dt
  }
  return ended
}

/** The skill a field manual teaches, or undefined if the item isn't one. */
export function manualSkill(item: string): SkillId | undefined {
  return SKILL_IDS.find((id) => SKILLS[id].manual === item)
}

/** Everything the levels change, as multipliers (1 = no change) or additions. */
export interface SkillEffects {
  /** How fast the sights come up (× speed). */
  aimSpeed: number
  /** Scope sway and recoil kick (×). */
  sway: number
  recoil: number
  /** Time between melee swings (×), and melee damage (×). */
  swingTime: number
  meleeDamage: number
  /** How far your footsteps carry (×), and how much harder you are to see (+, like camo). */
  stepNoise: number
  hidden: number
  /** Seconds to use a med (×), and health it gives (×). */
  medTime: number
  medHeal: number
  /** Seconds to fix a car (×), and damage the car you drive takes (×). */
  fixTime: number
  carDamage: number
  /** Seconds to nail a plank or make something with planks (×); battering your boards take (×). */
  buildTime: number
  boardDamage: number
  /** Breath for sprinting (× seconds). */
  sprint: number
}

/** What a character's levels add up to. */
export function skillEffects(skills: Skills | undefined): SkillEffects {
  const l = (id: SkillId) => skillLevel(skills, id)
  return {
    aimSpeed: 1 + 0.05 * l('aim'),
    sway: 1 - 0.05 * l('aim'),
    recoil: 1 - 0.05 * l('aim'),
    swingTime: 1 - 0.04 * l('melee'),
    meleeDamage: 1 + 0.05 * l('melee'),
    stepNoise: 1 - 0.05 * l('stealth'),
    hidden: 0.04 * l('stealth'),
    medTime: 1 - 0.06 * l('medic'),
    medHeal: 1 + 0.05 * l('medic'),
    fixTime: 1 - 0.06 * l('mechanic'),
    carDamage: 1 - 0.05 * l('mechanic'),
    buildTime: 1 - 0.06 * l('carpentry'),
    boardDamage: 1 - 0.05 * l('carpentry'),
    sprint: 1 + 0.05 * l('fitness'),
  }
}

/** "Aim 2" — what a level-up toast says. */
export function levelUpText(id: SkillId, level: number): string {
  return `${SKILLS[id].name} ${level}`
}

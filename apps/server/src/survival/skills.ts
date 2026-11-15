import {
  freshSkills,
  gainSkill,
  levelUpText,
  type Notice,
  type PlayerBody,
  type PlayerState,
  readManual,
  SKILL_GAIN,
  SKILLS,
  type SkillId,
  type Skills,
  type SurvivalSelf,
  skillEffects,
  skillLevel,
  TICK_DT,
  tickSkills,
  type WeaponRules,
} from '@office-fps/shared'

/** The bits of a survivor skills need. */
export interface SkillSurvivor {
  player: { id: number; state: PlayerState; body: PlayerBody }
  self: SurvivalSelf
  dirty: boolean
}

/** What the skills keeper asks of the director. */
export interface SkillsHost {
  notice(sv: SkillSurvivor, kind: Notice['kind'], text: string): void
  /** One of the dead within `r` m that hasn't noticed anybody. */
  unawareNear(sv: SkillSurvivor, r: number): boolean
  /** Sitting in a car. */
  seated(sv: SkillSurvivor): boolean
  /** Fitness went up: how they run changes (needs.ts tunes movement). */
  retune(sv: SkillSurvivor): void
}

/** What we keep on each survivor between ticks. */
interface Track {
  /** Metres sprinted not yet counted. */
  sprinted: number
  /** The weapon rules before skills, the ones we gave the body, and for which levels. */
  base?: WeaponRules
  tuned?: WeaponRules
  key: string
  /** Experience last sent to the client (the journal's bars), and when (s since joining). */
  told: number
  since: number
}

/** Faster than this on the ground is sprinting (m/s); creeping is anything over SNEAK. */
const SPRINT = 6
const SNEAK = 0.5
/** Near enough to one of the dead for sneaking past it to teach you anything (m). */
const SNEAK_NEAR = 14
/** The journal's bars are brought up to date at most this often (s) between level-ups. */
const TELL_EVERY = 10

/** A line under the level-up, by skill (grim and short). */
const LEVEL_LINE: Record<SkillId, string> = {
  aim: 'Your hands are steadier.',
  melee: 'Your swing comes easier.',
  stealth: 'You move quieter.',
  medic: 'Your hands know the work.',
  mechanic: 'Engines make more sense.',
  carpentry: 'The nails go in straighter.',
  fitness: 'You run longer.',
}

/**
 * Learn-by-doing skills on the server (see skills.ts in shared): experience from what people do,
 * level-ups told as a toast, field manuals read, and what the levels change — weapon handling
 * (given to the body, as the client predicts), breath, and the numbers the director asks for.
 */
export class SkillsKeeper {
  private readonly host: SkillsHost
  private readonly tracks = new WeakMap<object, Track>()
  /** How hard each boarded gap's battering lands (×), from whoever nailed it last (Carpentry). */
  private readonly boards = new Map<number, number>()

  constructor(host: SkillsHost) {
    this.host = host
  }

  private track(sv: SkillSurvivor): Track {
    let t = this.tracks.get(sv.player)
    if (!t) {
      t = { sprinted: 0, key: '', told: 0, since: 0 }
      this.tracks.set(sv.player, t)
    }
    return t
  }

  /** The survivor's skills (made if an old save had none). */
  of(sv: SkillSurvivor): Skills {
    sv.self.skills ??= freshSkills()
    return sv.self.skills
  }

  level(sv: SkillSurvivor, id: SkillId): number {
    return skillLevel(sv.self.skills, id)
  }

  effects(sv: SkillSurvivor | undefined): ReturnType<typeof skillEffects> {
    return skillEffects(sv?.self.skills)
  }

  /** Experience for something done; a level-up is told and takes effect at once. */
  gain(sv: SkillSurvivor, id: SkillId, amount: number): void {
    const up = gainSkill(this.of(sv), id, amount)
    if (up === null) return
    this.host.notice(sv, 'info', `${levelUpText(id, up)} — ${LEVEL_LINE[id]}`)
    sv.dirty = true
    const t = this.track(sv)
    t.told = this.total(sv)
    this.tune(sv)
    if (id === 'fitness') this.host.retune(sv)
  }

  /** A field manual read through: its skill learns three times as fast for half an hour. */
  read(sv: SkillSurvivor, id: SkillId): void {
    readManual(this.of(sv), id)
    sv.dirty = true
    this.host.notice(
      sv,
      'info',
      `You read it cover to cover. ${SKILLS[id].name} comes three times as fast for half an hour.`,
    )
  }

  /** Every tick (alive): metres sprinted, for Fitness. */
  watch(sv: SkillSurvivor): void {
    const s = sv.player.state
    const speed = Math.hypot(s.vel.x, s.vel.z)
    if (speed > SPRINT && s.grounded && !s.crouched) this.track(sv).sprinted += speed * TICK_DT
  }

  /** Once a second (alive): the manuals' clocks, sneaking, sprinting, and the weapon rules. */
  second(sv: SkillSurvivor): void {
    const skills = this.of(sv)
    const t = this.track(sv)
    t.since++
    if (tickSkills(skills, 1)) {
      sv.dirty = true
      this.host.notice(sv, 'info', 'The field manual has done what it can.')
    }
    const s = sv.player.state
    const seated = this.host.seated(sv)
    if (
      !seated &&
      s.crouched &&
      Math.hypot(s.vel.x, s.vel.z) > SNEAK &&
      this.host.unawareNear(sv, SNEAK_NEAR)
    )
      this.gain(sv, 'stealth', SKILL_GAIN.sneakSecond)
    if (t.sprinted >= 1) {
      const metres = Math.min(t.sprinted, 20)
      t.sprinted = 0
      if (!seated) this.gain(sv, 'fitness', metres * SKILL_GAIN.sprintMetre)
    }
    // The journal's bars creep along now and then (a level-up is told at once).
    const total = this.total(sv)
    if (total !== t.told && t.since % TELL_EVERY === 0) {
      t.told = total
      sv.dirty = true
    }
    this.tune(sv)
  }

  /** All experience, to tell when it changed. */
  private total(sv: SkillSurvivor): number {
    let n = 0
    for (const xp of Object.values(this.of(sv).xp)) n += xp ?? 0
    return Math.floor(n)
  }

  /**
   * Gives the body the weapon handling for these levels (Aim, Melee). The game swaps in fresh
   * rules now and then (rules change, respawn): those become the new base.
   */
  tune(sv: SkillSurvivor): void {
    const t = this.track(sv)
    const body = sv.player.body
    const fx = skillEffects(sv.self.skills)
    const key = `${fx.aimSpeed},${fx.sway},${fx.swingTime}`
    const replaced = body.weaponRules !== t.tuned
    if (!replaced && key === t.key) return
    const base = replaced ? body.weaponRules : (t.base ?? body.weaponRules)
    t.base = base
    t.key = key
    t.tuned = { ...base, aimSpeed: fx.aimSpeed, swayScale: fx.sway, swingTime: fx.swingTime }
    body.weaponRules = t.tuned
  }

  // --- Barricades (Carpentry) -----------------------------------------------------------------

  /** Somebody nailed a plank across gap `i`: it holds as well as they nail. */
  nailed(sv: SkillSurvivor, i: number): void {
    this.boards.set(i, skillEffects(sv.self.skills).boardDamage)
  }

  /** How hard battering lands on gap `i` (×). */
  boardDamage(i: number): number {
    return this.boards.get(i) ?? 1
  }

  /** Gap `i` is bare again. */
  cleared(i: number): void {
    this.boards.delete(i)
  }
}

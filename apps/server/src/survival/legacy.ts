import {
  addObituary,
  bumpLife,
  cleanLegacy,
  cleanWall,
  earnedTrait,
  FLOWER_SECONDS,
  freshWall,
  isTrait,
  type Legacy,
  leaveFlowers,
  type Notice,
  type ObitWall,
  PICK_SECONDS,
  recordLife,
  type SurvivalSelf,
  TRAITS,
  type TraitId,
  traitFactor,
  ZombieKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Saves } from '../saves.ts'

/**
 * What outlives a character, the server's side (ROADMAP 4.3–4.5; shared rules in legacy.ts):
 * the account's journal of past lives and the traits they left, the trait a new character
 * picks, and Haven's obituary wall with its flowers.
 */

/** Somebody playing (the director's Survivor, as far as this needs it). */
export interface Mourner {
  player: ServerPlayer
  self: SurvivalSelf
  dirty: boolean
}

export interface LegacyHost {
  /** The game's saves (asked each time: the game swaps them for real ones on start-up). */
  saves(): Saves
  /** Seconds since the server started. */
  now(): number
  /** Everybody playing (told when the wall changes). */
  everyone(): Iterable<Mourner>
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
}

/** How somebody died, as far as the wall needs to know. */
export interface Death {
  turning: boolean
  /** The kind of dead thing that did it, if one did. */
  zombie: number | null
  /** Somebody else who did it, if anybody. */
  by: string | null
}

/** Survival's sprint lasts this long (rules.ts sprintSeconds), for Long Legs. */
const SPRINT_SECONDS = 9
/** A step longer than this in a second wasn't walking (a car, a respawn, a teleport). */
const MAX_STEP = 9

/** The account sub-key this feature owns (saves.ts AccountSave). */
const KEY = 'legacy'

/** The line on the wall: how they went. */
export function causeOfDeath(
  d: Death,
  self: Pick<SurvivalSelf, 'bleeding' | 'hunger' | 'thirst'>,
): string {
  if (d.turning) return 'Turned'
  if (d.zombie !== null) {
    if (d.zombie === ZombieKind.Brute) return 'Broken by a brute'
    if (d.zombie === ZombieKind.Runner) return 'Run down by the dead'
    if (d.zombie === ZombieKind.Stalker) return 'Taken by something unseen'
    return 'Taken by the dead'
  }
  if (d.by) return `Killed by ${d.by}`
  if (self.bleeding) return 'Bled out'
  if (self.thirst <= 0) return 'Died of thirst'
  if (self.hunger <= 0) return 'Starved'
  return 'Died alone'
}

export class LegacyKeeper {
  private readonly host: LegacyHost
  /** Haven's obituary wall (saved with the world). */
  wall: ObitWall = freshWall()
  /** Raised whenever the wall changes; what each player was last sent. */
  private wallRev = 1
  private readonly sentWall = new Map<number, number>()
  /** Raised whenever an account's legacy changes (by account); what each player was sent. */
  private readonly legacyRev = new Map<string, number>()
  private readonly sentLegacy = new Map<number, number>()
  /** When each player may leave flowers again (s). */
  private readonly flowersAt = new Map<number, number>()
  /** Where each player stood a second ago (walking distance). */
  private readonly lastAt = new Map<number, { x: number; z: number }>()

  constructor(host: LegacyHost) {
    this.host = host
  }

  /** A new world: an empty wall. */
  reset(): void {
    this.wall = freshWall()
    this.wallRev++
  }

  /** The wall as it was saved. */
  restore(raw: unknown): void {
    this.wall = cleanWall(raw)
    this.wallRev++
  }

  /** An account's legacy (empty for guests). */
  legacyOf(player: ServerPlayer): Legacy {
    return player.account
      ? cleanLegacy(this.host.saves().account(player.account)[KEY])
      : { lives: [], traits: [] }
  }

  /** Somebody joins: a brand new character carries the newest trait (they can pick another). */
  join(m: Mourner): void {
    this.sentWall.delete(m.player.id)
    this.sentLegacy.delete(m.player.id)
    this.lastAt.delete(m.player.id)
    if (m.self.trait === undefined) this.newCharacter(m)
    else if (m.self.trait !== null && !isTrait(m.self.trait)) m.self.trait = null
  }

  /** Forgets somebody who left. */
  forget(player: ServerPlayer): void {
    this.sentWall.delete(player.id)
    this.sentLegacy.delete(player.id)
    this.flowersAt.delete(player.id)
    this.lastAt.delete(player.id)
  }

  /** A fresh character (after a death): they carry the newest trait their account has. */
  newCharacter(m: Mourner): void {
    m.self.trait = this.legacyOf(m.player).traits[0] ?? null
    this.lastAt.delete(m.player.id)
    m.dirty = true
  }

  /**
   * Somebody died (call before their character is replaced): the life goes into their
   * account's journal with the trait it earned, and their name onto the wall. Returns the
   * trait the life earned.
   */
  died(m: Mourner, death: Death, look: number): TraitId | null {
    const { self, player } = m
    const life = self.life
    const cause = causeOfDeath(death, self)
    const at = Date.now()
    const name = self.bio?.name ?? player.name
    const alive = Math.max(0, Math.round(self.age ?? 0))
    const kills = life?.kills ?? 0
    const trait = earnedTrait(life)
    if (player.account) {
      const legacy = recordLife(this.legacyOf(player), {
        name,
        past: self.bio?.past ?? '',
        alive,
        kills,
        cause,
        at,
        look,
        trait,
      })
      this.host.saves().putAccount(player.account, KEY, legacy)
      this.legacyRev.set(player.account, (this.legacyRev.get(player.account) ?? 0) + 1)
    }
    this.wall = addObituary(this.wall, { name, alive, kills, cause, look, at, flowers: 0 })
    this.wallChanged()
    return trait
  }

  /** A new character picks the trait to carry (null: none), if it's early enough. */
  pick(m: Mourner, id: unknown): void {
    if (id !== null && !isTrait(id)) return
    if ((m.self.age ?? 0) > PICK_SECONDS) {
      this.host.notice(m.player, 'info', 'Too late to change who you are now.')
      return
    }
    if (id !== null && !this.legacyOf(m.player).traits.includes(id)) return
    m.self.trait = id
    m.dirty = true
    if (id) this.host.notice(m.player, 'info', `You carry ${TRAITS[id].name}. ${TRAITS[id].desc}`)
  }

  /** E at the wall: flowers for the newest name (once in a while per player). */
  flowers(m: Mourner): void {
    const now = this.host.now()
    const at = this.flowersAt.get(m.player.id) ?? 0
    if (now < at) {
      this.host.notice(m.player, 'info', 'You stand a while longer.')
      return
    }
    this.flowersAt.set(m.player.id, now + FLOWER_SECONDS)
    const newest = this.wall.dead[0]
    this.wall = leaveFlowers(this.wall)
    this.wallChanged()
    this.host.notice(
      m.player,
      'info',
      newest
        ? `You leave a few wildflowers under ${newest.name}'s name.`
        : 'You leave a few wildflowers at the wall.',
    )
  }

  /** Once a second for everyone alive: how far they walked, and Long Legs' extra breath. */
  second(m: Mourner, seated: boolean): void {
    const { pos } = m.player.state
    const was = this.lastAt.get(m.player.id)
    this.lastAt.set(m.player.id, { x: pos.x, z: pos.z })
    if (was && !seated) {
      const d = Math.hypot(pos.x - was.x, pos.z - was.z)
      if (d > 0.05 && d < MAX_STEP) bumpLife(m.self, 'walked', d)
    }
    // Long Legs: a little of every second's sprint comes back.
    const s = m.player.state
    const keep = 1 - traitFactor(m.self.trait, 'stamina')
    if (keep > 0 && s.stamina < 1) s.stamina = Math.min(1, s.stamina + keep / SPRINT_SECONDS)
  }

  /** Dawn: everyone alive saw another night through. */
  dawn(alive: Iterable<Mourner>): void {
    for (const m of alive) bumpLife(m.self, 'nights')
  }

  /** What goes out to a player: their self, with the wall and their legacy when changed. */
  outgoing(m: Mourner): SurvivalSelf {
    const id = m.player.id
    const account = m.player.account
    const rev = account ? (this.legacyRev.get(account) ?? 0) : 0
    const out: SurvivalSelf = { ...m.self }
    if (this.sentLegacy.get(id) !== rev) {
      this.sentLegacy.set(id, rev)
      out.legacy = this.legacyOf(m.player)
    }
    if (this.sentWall.get(id) !== this.wallRev) {
      this.sentWall.set(id, this.wallRev)
      out.wall = this.wall
    }
    return out
  }

  private wallChanged(): void {
    this.wallRev++
    for (const m of this.host.everyone()) m.dirty = true
  }
}

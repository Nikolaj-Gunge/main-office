import {
  type Ground,
  groundAt,
  LAWLESS_TEXT,
  type Notice,
  OATH_SECONDS,
  type Poi,
  packStanding,
  REP_MAX,
  REP_MIN,
  type StandingTag,
  type SurvivalSelf,
  standingOf,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'

/**
 * PvP by choice (ROADMAP 5.7), the server's half: who may hurt whom where (one gate, asked by
 * the Game for every hit), reputation from what people do to each other, truces made by waving
 * at each other, and the Oathbreaker mark for whoever kills somebody they had a truce with.
 */

/** What the keeper needs from the director. */
export interface PvpHost {
  pois(): readonly Poi[]
  /** Game time (s). */
  now(): number
  /** A living person's character, if they are one. */
  selfOf(player: ServerPlayer): SurvivalSelf | null
  /** Their backpack (and so their reputation) changed: tell them. */
  touch(player: ServerPlayer): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** Is this safe place under attack right now (the dead may hurt people inside it)? */
  besieged(poi: Poi): boolean
  /** Everyone's standing changed: tell everybody. */
  broadcast(): void
}

/** You shot at them this recently (s): them killing you is self-defence. */
export const PROVOKE_SECONDS = 90
/** Killing somebody who hadn't shot at you costs this much reputation. */
export const MURDER = 5
/** A wave at somebody is an offer of a truce for this long (s). */
export const OFFER_SECONDS = 30
/** You wave at whoever you look at within this (m). */
export const WAVE_REACH = 10
/** Putting down one of the dead that just bit somebody else counts as help within this (s). */
export const RESCUE_SECONDS = 10
/** Help counts towards being a Saint at most once per this (s) per person. */
export const HELP_COOLDOWN = 60
/** A gift (something you dropped that another picks up) counts once per this (s). */
export const GIFT_COOLDOWN = 5 * 60
/** A dropped thing is a gift if picked up within this (m and s) of where it was dropped. */
const GIFT_REACH = 2
const GIFT_SECONDS = 120
/** Reputation drifts back towards nothing by one point per this (s of play). */
export const REP_DRIFT_SECONDS = 15 * 60

const isPerson = (p: ServerPlayer) => !p.zombie && !p.dummy
const pair = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

export class PvpKeeper {
  private readonly host: PvpHost
  /** Who hurt whom: victim id → attacker id → when (s). */
  private readonly hurtBy = new Map<number, Map<number, number>>()
  /** The last person each of the dead drew blood from, and when. */
  private readonly bitten = new Map<number, { victim: number; at: number }>()
  /** Truces, as "lowId:highId". */
  private readonly truces = new Set<string>()
  /** Who each person last waved at, and when. */
  private readonly offers = new Map<number, { to: number; at: number }>()
  /** The ground each person was last on (for the notices on crossing the border). */
  private readonly ground = new Map<number, Ground>()
  /** When each person last earned help or a gift (s). */
  private readonly helpedAt = new Map<number, number>()
  private readonly giftAt = new Map<number, number>()
  /** Things dropped lately: by whom, what, where, when. */
  private drops: { by: number; item: string; x: number; z: number; at: number }[] = []

  constructor(host: PvpHost) {
    this.host = host
  }

  groundOf(player: ServerPlayer): Ground {
    return groundAt(this.host.pois(), player.state.pos)
  }

  /**
   * The gate: may `attacker` hurt `victim`? Inside Haven nobody is hurt (only the dead, while
   * they besiege it); out in the woods people can't hurt each other; on Lawless ground anyone can.
   */
  canHurt(attacker: ServerPlayer, victim: ServerPlayer): boolean {
    if (attacker === victim || !isPerson(victim)) return true
    const pois = this.host.pois()
    const where = groundAt(pois, victim.state.pos)
    if (where === 'haven') {
      if (!attacker.zombie) return false
      return pois.some((p) => p.safe && this.host.besieged(p))
    }
    if (!isPerson(attacker)) return true
    return where === 'lawless' && groundAt(pois, attacker.state.pos) === 'lawless'
  }

  onDamage(victim: ServerPlayer, attacker: ServerPlayer, amount: number): void {
    if (amount <= 0 || attacker === victim) return
    const now = this.host.now()
    if (attacker.zombie && isPerson(victim)) {
      this.bitten.set(attacker.id, { victim: victim.id, at: now })
      return
    }
    if (!isPerson(attacker) || !isPerson(victim)) return
    const by = this.hurtBy.get(victim.id) ?? new Map<number, number>()
    by.set(attacker.id, now)
    this.hurtBy.set(victim.id, by)
  }

  onKill(victim: ServerPlayer, killer: ServerPlayer): void {
    const now = this.host.now()
    // One of the dead put down while it was on somebody else: that's help.
    if (victim.zombie) {
      const bite = this.bitten.get(victim.id)
      this.bitten.delete(victim.id)
      if (bite && isPerson(killer) && bite.victim !== killer.id && now - bite.at < RESCUE_SECONDS)
        this.help(killer, 1, 'helpedAt', HELP_COOLDOWN)
      return
    }
    if (!isPerson(victim) || !isPerson(killer) || killer === victim)
      return void this.forgetLife(victim)
    const killerSelf = this.host.selfOf(killer)
    const victimSelf = this.host.selfOf(victim)
    if (killerSelf) {
      const shotAt = this.hurtBy.get(killer.id)?.get(victim.id)
      const provoked = shotAt !== undefined && now - shotAt < PROVOKE_SECONDS
      // Raiders and oathbreakers are fair game; anybody else who never raised a gun is murdered.
      const fair =
        victimSelf && (standingOf(victimSelf.rep) === 'raider' || (victimSelf.oath ?? 0) > 0)
      if (!provoked && !fair) {
        const was = standingOf(killerSelf.rep)
        this.addRep(killerSelf, -MURDER)
        if (was !== 'raider' && standingOf(killerSelf.rep) === 'raider')
          this.host.notice(
            killer,
            'warn',
            "They never raised a gun at you. People will know: you wear a raider's red now.",
          )
        this.host.touch(killer)
      }
      if (this.truces.has(pair(killer.id, victim.id))) {
        killerSelf.oath = OATH_SECONDS
        this.host.notice(
          killer,
          'warn',
          'You broke a truce. Oathbreaker, they will call you, and they will see it on you.',
        )
        this.host.notice(victim, 'warn', `${killer.name} broke your truce.`)
        this.host.touch(killer)
      }
    }
    this.forgetLife(victim)
    this.tell()
  }

  /**
   * A wave (the friendly emote): at whoever you're looking at, close. If they waved at you a
   * moment ago, that's a truce; otherwise they're told you offer one.
   */
  onWave(player: ServerPlayer, people: Iterable<ServerPlayer>): void {
    if (!isPerson(player) || !player.state.alive) return
    const target = this.facing(player, people)
    if (!target) return
    const now = this.host.now()
    const key = pair(player.id, target.id)
    if (this.truces.has(key)) return
    const theirs = this.offers.get(target.id)
    if (theirs && theirs.to === player.id && now - theirs.at < OFFER_SECONDS) {
      this.offers.delete(target.id)
      this.truces.add(key)
      for (const [a, b] of [
        [player, target],
        [target, player],
      ] as const) {
        this.host.notice(a, 'info', `Truce with ${b.name}. Break it and everyone will know.`)
        this.help(a, 1)
      }
      return
    }
    this.offers.set(player.id, { to: target.id, at: now })
    this.host.notice(target, 'info', `${player.name} waves at you: a truce. Wave back to agree.`)
  }

  /** Is there a truce between these two? */
  hasTruce(a: ServerPlayer, b: ServerPlayer): boolean {
    return this.truces.has(pair(a.id, b.id))
  }

  /** Somebody dropped something on the ground (picked up by another, it is a gift). */
  dropped(player: ServerPlayer, item: string, at: { x: number; z: number }): void {
    const now = this.host.now()
    this.drops = this.drops.filter((d) => now - d.at < GIFT_SECONDS)
    this.drops.push({ by: player.id, item, x: at.x, z: at.z, at: now })
  }

  /** Somebody picked something up: if another person just put it down, the giver did good. */
  pickedUp(
    player: ServerPlayer,
    item: string,
    at: { x: number; z: number },
    people: ReadonlyMap<number, ServerPlayer>,
  ): void {
    const now = this.host.now()
    const i = this.drops.findIndex(
      (d) =>
        d.item === item &&
        d.by !== player.id &&
        now - d.at < GIFT_SECONDS &&
        Math.hypot(d.x - at.x, d.z - at.z) < GIFT_REACH,
    )
    if (i < 0) return
    const [gift] = this.drops.splice(i, 1)
    const giver = gift && people.get(gift.by)
    if (giver) this.help(giver, 1, 'giftAt', GIFT_COOLDOWN)
  }

  /**
   * Once a second for each living person: the Oathbreaker mark wears off with play, reputation
   * drifts back towards nothing, and crossing the Lawless border is announced.
   */
  second(player: ServerPlayer): void {
    const self = this.host.selfOf(player)
    if (!self || !player.state.alive) return
    let changed = false
    if ((self.oath ?? 0) > 0) {
      self.oath = Math.max(0, (self.oath ?? 0) - 1)
      if (self.oath === 0) {
        delete self.oath
        this.host.notice(player, 'info', 'People have stopped calling you an oathbreaker.')
        changed = true
      }
    }
    const rep = self.rep ?? 0
    if (rep !== 0) {
      const was = standingOf(rep)
      const step = 1 / REP_DRIFT_SECONDS
      self.rep = rep > 0 ? Math.max(0, rep - step) : Math.min(0, rep + step)
      if (standingOf(self.rep) !== was) changed = true
    }
    const where = this.groundOf(player)
    const before = this.ground.get(player.id)
    this.ground.set(player.id, where)
    if (before !== undefined && before !== where) {
      if (where === 'lawless') this.host.notice(player, 'warn', LAWLESS_TEXT.enter)
      else if (before === 'lawless') this.host.notice(player, 'info', LAWLESS_TEXT.leave)
    }
    if (changed) {
      this.host.touch(player)
      this.tell()
    }
  }

  /** They left the game: their truces and offers go with them (their reputation is saved). */
  forget(player: ServerPlayer): void {
    this.forgetLife(player)
    this.ground.delete(player.id)
    this.helpedAt.delete(player.id)
    this.giftAt.delete(player.id)
  }

  /**
   * What a character's reputation and mark pass on to whoever they are next: dying doesn't wash
   * them off (or a raider would just die to be clean).
   */
  carry(from: SurvivalSelf, to: SurvivalSelf): void {
    if (from.rep) to.rep = from.rep
    if (from.oath) to.oath = from.oath
  }

  /** Everybody's armbands and marks, packed (SurvivalShared.standing); undefined = nobody. */
  shared(people: Iterable<ServerPlayer>): number[] | undefined {
    const tags: StandingTag[] = []
    for (const p of people) {
      const self = this.host.selfOf(p)
      if (!self) continue
      const standing = standingOf(self.rep)
      const oathbreaker = (self.oath ?? 0) > 0
      if (standing !== 'neutral' || oathbreaker) tags.push({ id: p.id, standing, oathbreaker })
    }
    return tags.length > 0 ? packStanding(tags) : undefined
  }

  /** Somebody's armband or mark changed: everybody is told. */
  private tell(): void {
    this.host.broadcast()
  }

  /** Reputation for doing good, at most once per `cooldown` s (by `which` clock). */
  private help(
    player: ServerPlayer,
    amount: number,
    which?: 'helpedAt' | 'giftAt',
    cooldown = 0,
  ): void {
    const self = this.host.selfOf(player)
    if (!self) return
    const now = this.host.now()
    if (which) {
      const last = this[which].get(player.id)
      if (last !== undefined && now - last < cooldown) return
      this[which].set(player.id, now)
    }
    const was = standingOf(self.rep)
    this.addRep(self, amount)
    if (was !== 'saint' && standingOf(self.rep) === 'saint')
      this.host.notice(
        player,
        'info',
        'Word gets round about what you do for people. A Saint, they say.',
      )
    this.host.touch(player)
    if (standingOf(self.rep) !== was) this.tell()
  }

  private addRep(self: SurvivalSelf, amount: number): void {
    self.rep = Math.max(REP_MIN, Math.min(REP_MAX, (self.rep ?? 0) + amount))
  }

  /** A life ended: truces and grudges made in it are gone. */
  private forgetLife(player: ServerPlayer): void {
    this.hurtBy.delete(player.id)
    for (const by of this.hurtBy.values()) by.delete(player.id)
    this.offers.delete(player.id)
    for (const [from, o] of this.offers) if (o.to === player.id) this.offers.delete(from)
    for (const key of this.truces) {
      const [a, b] = key.split(':').map(Number)
      if (a === player.id || b === player.id) this.truces.delete(key)
    }
  }

  /** The person `player` is looking at, within WAVE_REACH, or null. */
  private facing(player: ServerPlayer, people: Iterable<ServerPlayer>): ServerPlayer | null {
    const s = player.state
    const fx = -Math.sin(s.yaw)
    const fz = -Math.cos(s.yaw)
    let best: ServerPlayer | null = null
    let bestScore = 0.8
    for (const p of people) {
      if (p === player || !isPerson(p) || !p.state.alive) continue
      const dx = p.state.pos.x - s.pos.x
      const dz = p.state.pos.z - s.pos.z
      const d = Math.hypot(dx, dz)
      if (d > WAVE_REACH || d < 0.01) continue
      const score = (dx * fx + dz * fz) / d
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return best
  }
}

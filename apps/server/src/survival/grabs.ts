import { Button, type Notice, ZombieKind } from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'

/**
 * Grabbed! (ROADMAP spectacle 2.1). Now and then a walker whose blow lands doesn't let go: it
 * has hold of you. You're all but rooted and it keeps at you; mash Use (E) to wrench free, or a
 * friend close by pulls you loose (E on you) or knocks it off (a hit on it). Alone it lets go in
 * the end (HOLD_MAX), so it is never certain death. Crawlers under cars hold ankles their own way
 * (lurkers.ts); nobody held by one is grabbed by the other.
 */

/** Share of a walker's landed blows that turn into a grab. */
export const GRAB_CHANCE = 0.22
/** Presses of E that wrench you free (about two seconds of mashing). */
export const MASH_PRESSES = 9
/** Longest a grab lasts (s): then it loses its grip anyway. */
export const HOLD_MAX = 4
/** Share of walking speed while held. */
export const GRABBED_SPEED = 0.12
/** Hurt per second while held (s), on top of its claws. */
export const GRAB_DPS = 4
/** A friend within this (m) pulls you free with E. */
export const HELP_RANGE = 2.5
/** Not grabbed again this soon after getting loose (s). */
const COOLDOWN = 8
/** Those this close (m) are told somebody is caught. */
const SHOUT_RANGE = 20

/** What grabs need from the survival director. */
export interface GrabHost {
  now(): number
  random(): number
  /** The living person with this id. */
  person(id: number): ServerPlayer | undefined
  /** Everyone alive within `r` of `player`. */
  near(player: ServerPlayer, r: number): readonly ServerPlayer[]
  kind(zombie: ServerPlayer): ZombieKind | undefined
  /** May it take hold of them at all? (not shielded, in a car, held by something else…) */
  grabbable(victim: ServerPlayer, zombie: ServerPlayer): boolean
  hurt(victim: ServerPlayer, attacker: ServerPlayer, amount: number): void
  /** Their movement changed: set their body up again. */
  rules(player: ServerPlayer): void
  /** What they're sent about themselves changed. */
  changed(player: ServerPlayer): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
}

interface Hold {
  by: ServerPlayer
  since: number
  presses: number
  /** Hurt dealt so far (whole points), against GRAB_DPS × time held. */
  hurt: number
}

export class Grabs {
  private readonly host: GrabHost
  /** Victim id → what has them. */
  private readonly holds = new Map<number, Hold>()
  /** Victim id → when they got loose. */
  private readonly loose = new Map<number, number>()

  constructor(host: GrabHost) {
    this.host = host
  }

  reset(): void {
    this.holds.clear()
    this.loose.clear()
  }

  /** Who has hold of `player`, if anything does. */
  heldBy(player: ServerPlayer): ServerPlayer | undefined {
    return this.holds.get(player.id)?.by
  }

  /** Their speed (a share of walking) while held, or null. */
  heldSpeed(player: ServerPlayer): number | null {
    return this.holds.has(player.id) ? GRABBED_SPEED : null
  }

  /** One of the dead landed a blow: a walker may take hold. Returns true if it did. */
  struck(victim: ServerPlayer, zombie: ServerPlayer): boolean {
    const kind = this.host.kind(zombie)
    if (kind !== ZombieKind.Walker) return false
    if (this.holds.has(victim.id) || !victim.state.alive || !zombie.state.alive) return false
    const now = this.host.now()
    if (now < (this.loose.get(victim.id) ?? -Infinity) + COOLDOWN) return false
    // Running flat out, you tear past its hands.
    const running = (victim.state.prevButtons & Button.Sprint) !== 0
    if (running || !this.host.grabbable(victim, zombie)) return false
    if (this.host.random() >= GRAB_CHANCE) return false
    this.grab(victim, zombie)
    return true
  }

  /** It has them (also for tests). */
  grab(victim: ServerPlayer, zombie: ServerPlayer): void {
    this.holds.set(victim.id, { by: zombie, since: this.host.now(), presses: 0, hurt: 0 })
    this.host.rules(victim)
    this.host.changed(victim)
    this.host.notice(victim, 'warn', 'It has hold of you. Mash E to break free!')
    for (const p of this.host.near(victim, SHOUT_RANGE)) {
      if (p !== victim)
        this.host.notice(p, 'warn', `${victim.name} is caught! Get to them: E to pull them free.`)
    }
  }

  /**
   * Somebody pressed Use. Held: one more wrench at its grip (true: E is spent on this). Not held,
   * but right by somebody who is: they're pulled free (true).
   */
  use(player: ServerPlayer): boolean {
    const hold = this.holds.get(player.id)
    if (hold) {
      hold.presses++
      if (hold.presses >= MASH_PRESSES) this.release(player.id, 'You wrench yourself free.')
      return true
    }
    const p = player.state.pos
    for (const [id] of this.holds) {
      const held = this.host.person(id)
      if (!held) continue
      const q = held.state.pos
      if (Math.hypot(p.x - q.x, p.z - q.z) > HELP_RANGE || Math.abs(p.y - q.y) > 1.5) continue
      this.release(id, `${player.name} pulls you free.`)
      this.host.notice(player, 'info', `You pull ${held.name} free.`)
      return true
    }
    return false
  }

  /** Somebody hit one of the dead: if it has hold of somebody else, it is knocked loose. */
  hit(zombie: ServerPlayer, by: ServerPlayer): void {
    for (const [id, hold] of this.holds) {
      if (hold.by !== zombie || id === by.id) continue
      this.release(id, `${by.name} knocks it off you.`)
    }
  }

  /** One of the dead died: whatever it held is let go. */
  killed(zombie: ServerPlayer): void {
    for (const [id, hold] of this.holds) if (hold.by === zombie) this.release(id, null)
  }

  /** They died or left. */
  forget(player: ServerPlayer): void {
    this.holds.delete(player.id)
    this.loose.delete(player.id)
  }

  /** Every tick: it hurts, and in the end it loses its grip. */
  step(): void {
    const now = this.host.now()
    for (const [id, hold] of this.holds) {
      const victim = this.host.person(id)
      if (!victim?.state.alive) {
        this.holds.delete(id)
        continue
      }
      const z = hold.by
      const far = Math.hypot(z.state.pos.x - victim.state.pos.x, z.state.pos.z - victim.state.pos.z)
      if (!z.state.alive || far > 3) {
        this.release(id, null)
        continue
      }
      const owed = Math.floor((now - hold.since) * GRAB_DPS) - hold.hurt
      if (owed > 0) {
        hold.hurt += owed
        this.host.hurt(victim, z, owed)
        if (!victim.state.alive) continue
      }
      if (now - hold.since >= HOLD_MAX) this.release(id, 'Its grip slips. You tear loose.')
    }
  }

  private release(id: number, why: string | null): void {
    if (!this.holds.delete(id)) return
    this.loose.set(id, this.host.now())
    const victim = this.host.person(id)
    if (!victim) return
    this.host.rules(victim)
    this.host.changed(victim)
    if (why) this.host.notice(victim, 'info', why)
  }
}

import {
  Button,
  CRANK_NOISE,
  CRANK_REACH,
  CRANK_SECS,
  CRANK_SLIP,
  GATE_BASH,
  GATE_BROKEN_SECS,
  GATE_HOLD_SECS,
  GATE_HP,
  gateNight,
  HAVEN_CRANK,
  HAVEN_GATE_WIDTH,
  HAVEN_WALL,
  hasButton,
  type Notice,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'

/**
 * Haven's gate at night (shared/survival/haven-gate.ts): shut from nightfall to dawn, wound up
 * by somebody holding E on the winch inside (loud: the dead hear the chain), dropping shut on its
 * own a while after they let go, and battered open by enough of the dead.
 */

/** What the gate needs from the world (the director: see director.ts). */
export interface GateHost {
  now(): number
  /** The day's clock, 0–1. */
  time(): number
  /** Haven's middle (the camp is built unturned), or null in a world without it. */
  haven(): Point | null
  /** The living and the dead walking about (anyone who could stand in the gateway). */
  people(): ServerPlayer[]
  zombies(): ServerPlayer[]
  /** Opens or shuts gate HAVEN_GATE (the colliders, the world's gate bits). */
  setOpen(open: boolean): void
  /** The shared state changed (the winch moved): tell everybody soon. */
  broadcast(): void
  /** A noise at `at`: the dead within `metres` come to look. */
  alert(at: Point, metres: number): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
}

/** How long one bang on the gate takes before the next (s), and how far it carries (m). */
const KNOCK_EVERY = 1.5
const KNOCK_NOISE = 35
/** Inside this of Haven's middle (m) you're "inside" and hear the knocking. */
const HEARD_INSIDE = HAVEN_WALL + 4

export class HavenGate {
  private readonly host: GateHost
  /** Up (the colliders gone)? */
  open = true
  /** How far the winch is wound, 0–1. */
  crank = 0
  /** Whoever is at the winch. */
  private cranker: ServerPlayer | null = null
  /** It stays up till then (s, the world's clock). */
  private holdUntil = 0
  /** Battering it can still take; when it gives, it hangs open till brokenUntil. */
  hp = GATE_HP
  private brokenUntil = 0
  private nextSecond = 0
  private nextKnock = new Map<number, number>()
  private sentCrank = 0

  constructor(host: GateHost) {
    this.host = host
  }

  /** The winch in the world, or null without Haven. */
  winch(): Point | null {
    const h = this.host.haven()
    return h ? { x: h.x + HAVEN_CRANK[0], y: h.y, z: h.z + HAVEN_CRANK[1] } : null
  }

  /** The middle of the gateway, on the ground. */
  private gateway(): Point | null {
    const h = this.host.haven()
    return h ? { x: h.x, y: h.y, z: h.z - HAVEN_WALL } : null
  }

  get broken(): boolean {
    return this.host.now() < this.brokenUntil
  }

  /** Is it shut right now (what raiders and the dead find)? */
  get shut(): boolean {
    return !this.open
  }

  /** E on the winch. */
  use(player: ServerPlayer): void {
    if (!gateNight(this.host.time()))
      return void this.host.notice(player, 'info', 'The gate stands open by day.')
    if (this.broken)
      return void this.host.notice(
        player,
        'warn',
        'The gate hangs off its chain. It will not wind.',
      )
    if (this.cranker && this.cranker !== player && this.cranker.state.alive)
      return void this.host.notice(player, 'info', 'Somebody is already on the winch.')
    this.cranker = player
    if (this.open && this.crank >= 1) this.holdUntil = this.host.now() + GATE_HOLD_SECS
  }

  /** E on the outside of the gate: bang on it. Everybody inside hears; so do the dead. */
  knock(player: ServerPlayer): void {
    if (this.open) return void this.host.notice(player, 'info', 'The gate is open.')
    const at = this.gateway()
    if (!at) return
    const now = this.host.now()
    if (now < (this.nextKnock.get(player.id) ?? 0)) return
    this.nextKnock.set(player.id, now + KNOCK_EVERY)
    this.host.alert(at, KNOCK_NOISE)
    const h = this.host.haven()
    for (const p of this.host.people()) {
      if (p === player || !h) continue
      const pos = p.state.pos
      if (Math.abs(pos.x - h.x) < HEARD_INSIDE && Math.abs(pos.z - h.z) < HEARD_INSIDE)
        this.host.notice(
          p,
          'warn',
          `${player.name} is banging on the gate. Somebody turn the winch.`,
        )
    }
    this.host.notice(player, 'info', 'You bang on the gate. Somebody inside has to wind it up.')
  }

  /** Somebody left the world. */
  forget(player: ServerPlayer): void {
    if (this.cranker === player) this.cranker = null
    this.nextKnock.delete(player.id)
  }

  /** Every tick. */
  step(dt: number): void {
    const now = this.host.now()
    const night = gateNight(this.host.time())
    const winch = this.winch()
    if (!winch) return
    const c = this.cranker
    if (c) {
      const pos = c.state.pos
      const near = Math.hypot(pos.x - winch.x, pos.z - winch.z) <= CRANK_REACH
      if (!c.state.alive || !near || !hasButton(c.state.prevButtons, Button.Use) || !night)
        this.cranker = null
    }
    if (this.cranker) {
      this.crank = Math.min(1, this.crank + dt / CRANK_SECS)
      if (this.crank >= 1) this.holdUntil = now + GATE_HOLD_SECS
    } else if (!this.open || !night) {
      this.crank = Math.max(0, this.crank - CRANK_SLIP * dt)
    }
    if (now >= this.nextSecond) {
      this.nextSecond = now + 1
      // The chain rattling is heard a long way off.
      if (this.cranker) this.host.alert(winch, CRANK_NOISE)
      if (!this.open) this.batter()
      if (!night) this.hp = GATE_HP
    }
    const want = !night || now < this.holdUntil || now < this.brokenUntil
    if (want !== this.open) {
      // It never drops on anybody standing in the gateway: it waits for them to move.
      if (want || !this.blocked()) {
        this.open = want
        if (!want) {
          this.crank = 0
          if (!this.broken) this.hp = Math.max(this.hp, GATE_HP / 2)
        }
        this.host.setOpen(want)
      }
    }
    const shown = this.shown()
    if (shown !== this.sentCrank) {
      this.sentCrank = shown
      this.host.broadcast()
    }
  }

  /** How far the winch is wound, for SurvivalShared.crank (0–100 in steps of 10; 0: nobody). */
  shown(): number {
    return this.crank > 0 && gateNight(this.host.time()) ? Math.round(this.crank * 10) * 10 : 0
  }

  /** Anybody (alive) in the gateway? */
  private blocked(): boolean {
    const g = this.gateway()
    if (!g) return false
    for (const p of [...this.host.people(), ...this.host.zombies()]) {
      if (!p.state.alive) continue
      const { x, z } = p.state.pos
      if (Math.abs(x - g.x) < HAVEN_GATE_WIDTH / 2 + 0.5 && Math.abs(z - g.z) < 0.9) return true
    }
    return false
  }

  /** Once a second while shut: the dead pressed against the outside batter it. */
  private batter(): void {
    const g = this.gateway()
    if (!g) return
    let at = 0
    for (const z of this.host.zombies()) {
      if (!z.state.alive) continue
      const p = z.state.pos
      if (Math.abs(p.x - g.x) < HAVEN_GATE_WIDTH / 2 + 1 && p.z < g.z && p.z > g.z - 2.6) at++
    }
    if (at === 0) return
    this.hp -= at * GATE_BASH
    if (this.hp > 0) return
    this.hp = 0
    this.brokenUntil = this.host.now() + GATE_BROKEN_SECS
    const h = this.host.haven()
    for (const p of this.host.people()) {
      if (!h || Math.hypot(p.state.pos.x - h.x, p.state.pos.z - h.z) > 120) continue
      this.host.notice(p, 'warn', 'The gate gives! The dead are coming through. Hold the gateway!')
    }
  }
}

import {
  CHAT_NEARBY,
  type ChatChannel,
  cleanChat,
  EMOTE_RANGE,
  type GameRules,
  PING_KINDS,
  PING_RANGE,
  type PingKind,
  RateLimit,
  type ServerMessage,
  ServerMsg,
  type SocialEvent,
  type SocialRequest,
  TEAMS,
  TICK_RATE,
} from '@office-fps/shared'
import type { ServerPlayer } from './game.ts'

/** What the social relay needs from the game. */
export interface SocialHost {
  readonly players: ReadonlyMap<number, ServerPlayer>
  readonly tick: number
  readonly rules: GameRules
  sendTo(player: ServerPlayer, msg: ServerMessage): void
}

/** A ping further than this from whoever placed it is refused (m): nobody sees that far. */
const PING_REACH = 400

interface Limits {
  chat: RateLimit
  ping: RateLimit
  emote: RateLimit
  /** Last time they were told to slow down (s), so the warning isn't spam itself. */
  warned: number
}

/**
 * Chat, pings and waves: checks what a client sends (it could be anything), cleans it, rate
 * limits it and passes it on to whoever should hear it — nearby people in survival, the team or
 * everyone in the arena modes — except those who muted the sender.
 */
export class SocialRelay {
  private readonly limits = new Map<number, Limits>()
  /** Who each player muted. */
  private readonly muted = new Map<number, Set<number>>()

  private readonly host: SocialHost

  constructor(host: SocialHost) {
    this.host = host
  }

  handle(from: ServerPlayer, req: SocialRequest): void {
    if (!req || typeof req !== 'object' || from.zombie || from.bot) return
    const now = this.host.tick / TICK_RATE
    const limits = this.limitsOf(from.id)
    switch (req.kind) {
      case 'chat': {
        if (typeof req.text !== 'string') return
        const text = cleanChat(req.text)
        if (!text) return
        if (!limits.chat.take(now)) {
          this.slowDown(from, limits, now)
          return
        }
        const channel = this.channelFor(req.channel)
        const event: SocialEvent = { kind: 'chat', from: from.id, name: from.name, text, channel }
        const range = channel === 'nearby' ? CHAT_NEARBY : Number.POSITIVE_INFINITY
        this.relay(from, event, range, channel === 'team')
        return
      }
      case 'ping': {
        const { x, y, z } = req
        if (!PING_KINDS.includes(req.ping as PingKind)) return
        if (![x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) return
        const p = from.state.pos
        if (Math.hypot(x - p.x, y - p.y, z - p.z) > PING_REACH) return
        if (!limits.ping.take(now)) {
          this.slowDown(from, limits, now)
          return
        }
        const event: SocialEvent = { kind: 'ping', from: from.id, ping: req.ping, x, y, z }
        // Teams hear their own side's pings wherever they are; otherwise those close by.
        const teams = this.hasTeams()
        this.relay(from, event, teams ? Number.POSITIVE_INFINITY : PING_RANGE, teams)
        return
      }
      case 'emote': {
        if (!from.state.alive || !limits.emote.take(now)) return
        const range = this.survival() ? EMOTE_RANGE : Number.POSITIVE_INFINITY
        this.relay(from, { kind: 'emote', from: from.id }, range, false)
        return
      }
      case 'mute': {
        const target = this.host.players.get(req.id)
        if (typeof req.id !== 'number' || !target || target.id === from.id || target.zombie) return
        const set = this.muted.get(from.id) ?? new Set<number>()
        if (req.muted) set.add(target.id)
        else set.delete(target.id)
        this.muted.set(from.id, set)
        const text = req.muted ? `Muted ${target.name}.` : `${target.name} can be heard again.`
        this.host.sendTo(from, { type: ServerMsg.Social, social: { kind: 'system', text } })
        return
      }
    }
  }

  /** Does `listener` ignore `speaker`? */
  isMuted(listener: number, speaker: number): boolean {
    return this.muted.get(listener)?.has(speaker) ?? false
  }

  /** A player left: forget their limits and mutes, and that anyone muted them. */
  forget(id: number): void {
    this.limits.delete(id)
    this.muted.delete(id)
    for (const set of this.muted.values()) set.delete(id)
  }

  /** Sends `event` to people (the sender included) within `range` of the sender. */
  private relay(from: ServerPlayer, event: SocialEvent, range: number, teamOnly: boolean): void {
    const msg: ServerMessage = { type: ServerMsg.Social, social: event }
    const a = from.state.pos
    for (const to of this.host.players.values()) {
      if (to.zombie || to.bot || to.dummy) continue
      if (to.id !== from.id) {
        if (this.isMuted(to.id, from.id)) continue
        if (teamOnly && to.team !== from.team) continue
        const b = to.state.pos
        if (
          range !== Number.POSITIVE_INFINITY &&
          Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > range
        )
          continue
      }
      this.host.sendTo(to, msg)
    }
  }

  /** The channel a line really goes out on in this mode. */
  private channelFor(asked: ChatChannel): ChatChannel {
    if (this.survival()) return asked === 'all' ? 'all' : 'nearby'
    return asked === 'team' && this.hasTeams() ? 'team' : 'all'
  }

  private survival(): boolean {
    return this.host.rules.mode === 'survival'
  }

  /** Arena modes with sides (survival's "team" is everybody alive, so it has none here). */
  private hasTeams(): boolean {
    return !this.survival() && TEAMS[this.host.rules.mode] !== undefined
  }

  private slowDown(to: ServerPlayer, limits: Limits, now: number): void {
    if (now - limits.warned < 2) return
    limits.warned = now
    this.host.sendTo(to, {
      type: ServerMsg.Social,
      social: { kind: 'system', text: 'Slow down — wait a moment before sending more.' },
    })
  }

  private limitsOf(id: number): Limits {
    let limits = this.limits.get(id)
    if (!limits) {
      // Chat: 3 lines at once, then one every 5/3 s (3 per 5 s). Pings: 3, then one per 2 s.
      limits = {
        chat: new RateLimit(3, 5 / 3),
        ping: new RateLimit(3, 2),
        emote: new RateLimit(1, 3),
        warned: Number.NEGATIVE_INFINITY,
      }
      this.limits.set(id, limits)
    }
    return limits
  }
}

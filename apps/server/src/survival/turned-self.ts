import {
  Button,
  type InputCommand,
  type Notice,
  type ServerMessage,
  ServerMsg,
  type SocialRequest,
  type TurnedSelfState,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Zed } from './horde.ts'

/**
 * Your own turned self, for a minute (ROADMAP spectacle 4.2). Somebody who turns (the bite ran
 * its course, or the dead got them) and whose body gets up may take the wheel: for STEER_SECONDS
 * they walk what's left of them about at the dead's pace, with the claws and nothing else, and
 * groan instead of talking. Then (or once it's put down) the dead's own mind takes over again,
 * still carrying everything, and they wake at Haven as somebody new.
 *
 * The server does all of it: the body is one of the dead (the client only sends its usual input)
 * and the rules hold whoever steers it:
 *  - it never gets further than LEASH from where it got up, so nobody walks their own things
 *    home: and Haven's guards shoot it on sight within GUARD_RING of the fence;
 *  - its claws can't touch the newcomers' shield, or anyone inside a safe place;
 *  - no chat, no pings, no waves (a groan comes out instead), no items, no cars.
 */

/** How long you may steer what's left of you (s). */
export const STEER_SECONDS = 60
/** How long the offer stands before you wake at Haven anyway (s). */
export const OFFER_SECONDS = 12
/** How far it may go from where it got up (m). */
export const LEASH = 60
/** Haven's guards shoot one of the dead that comes this close to the fence (m past its edge). */
export const GUARD_RING = 30
/** How far a groan carries (m), and how often one comes out (s). */
export const GROAN_RANGE = 30
const GROAN_EVERY = 2
const GROANS = ['hhhrrrnnn…', 'uuhhhh…', 'ghhhk… hhhrr…', 'hhaaahhh…', 'rrrhhhnn…', 'nnnhhh…']

/** What the turned self needs from the survival director. */
export interface TurnedSelfHost {
  now(): number
  random(): number
  player(id: number): ServerPlayer | undefined
  zed(id: number): Zed | undefined
  /** Still one of the turned (up, and carrying what they had). */
  turned(id: number): boolean
  /** Haven and the other safe places. */
  safe(): readonly { x: number; z: number; r: number }[]
  /** A new character still under the newcomer's shield. */
  shielded(player: ServerPlayer): boolean
  /** The dead player waits this many more seconds before waking (unless woken sooner). */
  holdRespawn(player: ServerPlayer, seconds: number): void
  /** Wakes them at Haven now (if still dead). */
  wake(player: ServerPlayer): void
  /** The guards put it down (it dies; its things fall where it stood). */
  putDown(zombie: ServerPlayer): void
  /** What they're sent about themselves changed. */
  changed(player: ServerPlayer): void
  send(player: ServerPlayer, msg: ServerMessage): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** Everyone alive within `r` of `at`. */
  near(at: Point, r: number): readonly ServerPlayer[]
}

interface Offer {
  body: number
  until: number
}

interface Steering {
  body: number
  until: number
  /** Where it got up: the leash's centre. */
  from: Point
  groanAt: number
  /** The input carried over to ticks when no new one came (a late packet). */
  last: { buttons: number; yaw: number; pitch: number }
}

export class TurnedSelf {
  private readonly host: TurnedSelfHost
  /** Player id → the body they may take. */
  private readonly offers = new Map<number, Offer>()
  /** Player id → the body they steer. */
  private readonly steering = new Map<number, Steering>()
  /** Body id → who steers it. */
  private readonly bodies = new Map<number, number>()

  constructor(host: TurnedSelfHost) {
    this.host = host
  }

  reset(): void {
    this.offers.clear()
    this.steering.clear()
    this.bodies.clear()
  }

  /** `player` just turned and `body` got up: they may take the wheel for a while. */
  offer(player: ServerPlayer, body: ServerPlayer): void {
    this.offers.set(player.id, { body: body.id, until: this.host.now() + OFFER_SECONDS })
    this.host.holdRespawn(player, OFFER_SECONDS)
    this.host.changed(player)
  }

  /** Their answer: steer it (take) or wake at Haven now. */
  answer(player: ServerPlayer, take: boolean): void {
    const offer = this.offers.get(player.id)
    if (!offer) return
    this.offers.delete(player.id)
    const body = this.host.player(offer.body)
    const zed = this.host.zed(offer.body)
    const fit =
      take &&
      !player.state.alive &&
      this.host.now() < offer.until &&
      body?.state.alive === true &&
      zed !== undefined &&
      this.host.turned(offer.body) &&
      !this.bodies.has(offer.body)
    if (!fit || !body || !zed) {
      this.host.changed(player)
      this.host.wake(player)
      return
    }
    const s = body.state
    this.steering.set(player.id, {
      body: body.id,
      until: this.host.now() + STEER_SECONDS,
      from: { ...s.pos },
      groanAt: 0,
      last: { buttons: 0, yaw: s.yaw, pitch: 0 },
    })
    this.bodies.set(body.id, player.id)
    zed.steered = true
    // Their input sits waiting while they're dead: none of it is theirs to replay now.
    player.queue.length = 0
    this.host.holdRespawn(player, STEER_SECONDS + 5)
    this.host.changed(player)
  }

  /** Who steers this body, if anyone. */
  steererOf(body: ServerPlayer): ServerPlayer | undefined {
    const id = this.bodies.get(body.id)
    return id === undefined ? undefined : this.host.player(id)
  }

  /** Somebody is steering their turned self right now. */
  isSteering(player: ServerPlayer): boolean {
    return this.steering.has(player.id)
  }

  /**
   * The body's input this tick, from what the one steering it sent (all of it taken off their
   * own queue: a dead player's input moves nothing else). Null when nobody steers it.
   */
  command(body: ServerPlayer, tick: number): InputCommand | null {
    const id = this.bodies.get(body.id)
    const st = id === undefined ? undefined : this.steering.get(id)
    const player = id === undefined ? undefined : this.host.player(id)
    const zed = this.host.zed(body.id)
    if (!st || !player || !zed) return null
    const queued = player.queue.splice(0)
    let fire = 0
    for (const c of queued) {
      fire |= c.buttons & Button.Fire
      player.ackSeq = c.seq
    }
    const newest = queued.at(-1)
    if (newest) st.last = { buttons: newest.buttons | fire, yaw: newest.yaw, pitch: newest.pitch }
    const input = st.last
    // A click is one blow: it isn't held over into ticks without fresh input.
    if (!newest) input.buttons &= ~Button.Fire
    return zed.steer(body, input, tick)
  }

  /** Every tick: the leash, the guards, the clock, offers running out. */
  step(): void {
    const now = this.host.now()
    for (const [id, offer] of this.offers) {
      const player = this.host.player(id)
      const body = this.host.player(offer.body)
      if (player && !player.state.alive && now < offer.until && body?.state.alive) continue
      this.offers.delete(id)
      if (player) this.host.changed(player)
    }
    for (const [id, st] of this.steering) {
      const player = this.host.player(id)
      const body = this.host.player(st.body)
      if (!player) {
        this.end(id, null)
        continue
      }
      if (player.state.alive || !body?.state.alive || !this.host.turned(st.body)) {
        this.end(id, 'What was left of you is still now.')
        continue
      }
      if (now >= st.until) {
        this.end(id, 'It slips away from you, still walking.')
        continue
      }
      const p = body.state.pos
      // Haven's guards: one of the dead walking up to the fence is shot down.
      if (this.host.safe().some((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r + GUARD_RING)) {
        this.end(id, 'Rifles crack from the fence. The guards put it down.')
        this.host.putDown(body)
        continue
      }
      // The leash: it won't go further from where it got up.
      const dx = p.x - st.from.x
      const dz = p.z - st.from.z
      const d = Math.hypot(dx, dz)
      if (d > LEASH) {
        p.x = st.from.x + (dx / d) * LEASH
        p.z = st.from.z + (dz / d) * LEASH
      }
    }
  }

  /** Its body was put down: whoever steered it wakes now. */
  bodyKilled(body: ServerPlayer): void {
    const id = this.bodies.get(body.id)
    if (id !== undefined) this.end(id, 'Something puts what was left of you down.')
  }

  /** They left the game. */
  left(player: ServerPlayer): void {
    this.offers.delete(player.id)
    if (this.steering.has(player.id)) this.end(player.id, null)
  }

  /** May `attacker` hurt `victim`? Not when it's somebody steering their turned self at a newcomer, or at anyone in a safe place. */
  canHurt(attacker: ServerPlayer, victim: ServerPlayer): boolean {
    if (!this.bodies.has(attacker.id) || attacker === victim) return true
    if (this.host.shielded(victim)) return false
    const p = victim.state.pos
    return !this.host.safe().some((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r + 6)
  }

  /**
   * Something they'd say, ping or wave while steering: swallowed (true). Chat comes out of the
   * body as a groan to those close by.
   */
  social(player: ServerPlayer, req: SocialRequest): boolean {
    const st = this.steering.get(player.id)
    if (!st) return false
    const body = this.host.player(st.body)
    const now = this.host.now()
    if (!body || req?.kind !== 'chat' || now < st.groanAt) return true
    st.groanAt = now + GROAN_EVERY
    const text = GROANS[Math.floor(this.host.random() * GROANS.length)] as string
    const msg: ServerMessage = {
      type: ServerMsg.Social,
      social: { kind: 'chat', from: body.id, name: body.name, text, channel: 'nearby' },
    }
    for (const p of this.host.near(body.state.pos, GROAN_RANGE)) this.host.send(p, msg)
    this.host.send(player, msg)
    return true
  }

  /** What they're told about it (with every SurvivalSelf), or undefined: nothing. */
  viewOf(player: ServerPlayer): TurnedSelfState | undefined {
    const now = this.host.now()
    const st = this.steering.get(player.id)
    if (st) return { body: st.body, left: Math.max(0, Math.round((st.until - now) * 10) / 10) }
    const offer = this.offers.get(player.id)
    if (offer)
      return { body: offer.body, offer: Math.max(0, Math.round((offer.until - now) * 10) / 10) }
    return undefined
  }

  /** Where the steered walk (the forest is made solid around them too). */
  positions(): Point[] {
    const out: Point[] = []
    for (const id of this.bodies.keys()) {
      const body = this.host.player(id)
      if (body?.state.alive) out.push(body.state.pos)
    }
    return out
  }

  /** Hands it back to the dead's own mind; they wake at Haven. */
  private end(id: number, why: string | null): void {
    const st = this.steering.get(id)
    if (!st) return
    this.steering.delete(id)
    this.bodies.delete(st.body)
    const zed = this.host.zed(st.body)
    if (zed?.steered) {
      zed.steered = false
      zed.mood = 'wander'
    }
    const player = this.host.player(id)
    if (!player) return
    this.host.changed(player)
    if (why) this.host.notice(player, 'info', why)
    this.host.wake(player)
  }
}

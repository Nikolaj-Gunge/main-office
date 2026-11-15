import {
  flightSeconds,
  hoopAt,
  JUNK_LOOKS,
  JUNK_NOISE,
  type JunkSpot,
  junkSpots,
  KICK_REACH,
  KICK_SWING,
  KICK_WALK,
  type Poi,
  packJunk,
  type SocialEvent,
  SWING_REACH,
  throughHoop,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'

/**
 * Kickable junk, the server's half (shared junk.ts has the spots and the rules): who kicked what
 * where, the clatter that brings the dead, and Haven's barrel tally. No physics engine: a kick is
 * a straight line along the ground, cut short by the first wall, and the client draws the tumble.
 */

export interface JunkHost {
  pois(): readonly Poi[]
  /** Game time (s). */
  now(): number
  /** Nothing solid between two points. */
  lineClear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean
  /** Tell everybody near `at` (they see it fly). */
  tell(event: SocialEvent, at: { x: number; z: number }): void
  /** It clattered: the dead within `r` come to look. */
  alert(at: { x: number; y: number; z: number }, r: number): void
  /** Somebody got one in the barrel; `tally` is Haven's count so far. */
  scored(player: ServerPlayer, tally: number): void
  /** Where they lie changed: the shared state goes out again. */
  changed(): void
}

/** Kicked junk comes back where it belongs after this long untouched (s), unless somebody's near. */
export const RETURN_SECONDS = 20 * 60
/** Somebody within this (m) keeps it where it is. */
const WATCHED = 40
/** One person's walking kicks of the same thing: no more than one per this (s). */
const NUDGE_COOLDOWN = 0.6

interface Piece {
  spot: JunkSpot
  x: number
  z: number
  /** In the air until this (s). */
  flyingUntil: number
  /** Last moved (s); null while it lies where it belongs. */
  movedAt: number | null
  /** In the barrel: goes home when it lands. */
  sunk: boolean
}

export class Junk {
  private readonly host: JunkHost
  /** Built the first time it's needed (the map's places may not be in yet at construction). */
  private built: Piece[] | null = null
  private hoop: { x: number; y: number; z: number } | null = null
  /** Haven's barrel tally (kept while the server runs). */
  tally = 0

  constructor(host: JunkHost) {
    this.host = host
  }

  private get pieces(): Piece[] {
    if (this.built) return this.built
    const pois = this.host.pois()
    const pieces = junkSpots(pois).map((spot) => ({
      spot,
      x: spot.x,
      z: spot.z,
      flyingUntil: 0,
      movedAt: null,
      sunk: false,
    }))
    if (pois.length > 0) {
      this.built = pieces
      this.hoop = hoopAt(pois)
    }
    return pieces
  }

  get count(): number {
    return this.pieces.length
  }

  /** Where piece `i` lies now. */
  at(i: number): { x: number; z: number } | null {
    const p = this.pieces[i]
    return p ? { x: p.x, z: p.z } : null
  }

  /** Every few ticks: anybody walking into junk nudges it along the way they're going. */
  step(people: readonly ServerPlayer[]): void {
    const now = this.host.now()
    for (const p of this.pieces) {
      if (!p.sunk || now < p.flyingUntil) continue
      this.home(p)
      this.host.changed()
    }
    for (const player of people) {
      const s = player.state
      if (!s.alive) continue
      const speed = Math.hypot(s.vel.x, s.vel.z)
      if (speed < 1.2) continue
      for (const p of this.pieces) {
        if (now < p.flyingUntil || Math.abs(p.spot.y - s.pos.y) > 1.2) continue
        const reach = KICK_REACH + JUNK_LOOKS[p.spot.kind].r
        if (Math.abs(p.x - s.pos.x) > reach || Math.abs(p.z - s.pos.z) > reach) continue
        if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) > reach) continue
        const power = Math.min(1, speed / 6)
        this.kick(
          player,
          p,
          s.vel.x / speed,
          s.vel.z / speed,
          KICK_WALK * (0.5 + power * 0.5),
          NUDGE_COOLDOWN,
        )
      }
    }
  }

  /** A swing (any melee): the nearest junk in front goes flying the way they face. */
  swing(player: ServerPlayer): boolean {
    const s = player.state
    const fx = -Math.sin(s.yaw)
    const fz = -Math.cos(s.yaw)
    const now = this.host.now()
    let best: Piece | null = null
    let bestD = SWING_REACH
    for (const p of this.pieces) {
      if (now < p.flyingUntil || Math.abs(p.spot.y - s.pos.y) > 1.2) continue
      const dx = p.x - s.pos.x
      const dz = p.z - s.pos.z
      const d = Math.hypot(dx, dz)
      if (d >= bestD) continue
      // In front (or right underfoot).
      if (d > 0.3 && (dx * fx + dz * fz) / d < 0.5) continue
      best = p
      bestD = d
    }
    if (!best) return false
    // Looking up lofts it a little further, looking down scuffs it.
    const loft = Math.max(0.6, Math.min(1.2, 1 + s.pitch * 0.5))
    this.kick(player, best, fx, fz, KICK_SWING * loft, 0)
    return true
  }

  /** Once a second: what has lain untouched long enough with nobody near goes home. */
  second(people: readonly ServerPlayer[]): void {
    const now = this.host.now()
    let moved = false
    for (const p of this.pieces) {
      if (p.movedAt === null || now - p.movedAt < RETURN_SECONDS) continue
      const watched = people.some(
        (q) => Math.hypot(q.state.pos.x - p.spot.x, q.state.pos.z - p.spot.z) < WATCHED,
      )
      if (watched) continue
      this.home(p)
      moved = true
    }
    if (moved) this.host.changed()
  }

  /** Where moved junk lies (SurvivalShared.junk), or undefined when everything is home. */
  shared(): number[] | undefined {
    const moved = this.pieces.filter((p) => p.x !== p.spot.x || p.z !== p.spot.z)
    return moved.length > 0
      ? packJunk(moved.map((p) => ({ i: p.spot.i, x: p.x, z: p.z })))
      : undefined
  }

  private kick(
    player: ServerPlayer,
    p: Piece,
    dx: number,
    dz: number,
    distance: number,
    cooldown: number,
  ): void {
    const now = this.host.now()
    if (p.movedAt !== null && now - p.movedAt < cooldown) return
    const look = JUNK_LOOKS[p.spot.kind]
    const want = distance * look.carry
    const from = { x: p.x, y: p.spot.y + 0.3, z: p.z }
    // Cut short by the first wall: back off along the line until it's clear.
    let reach = want
    for (let k = 0; k < 5; k++) {
      const to = { x: p.x + dx * reach, y: from.y, z: p.z + dz * reach }
      if (this.host.lineClear(from, to)) break
      reach *= 0.6
      if (k === 4) reach = 0
    }
    const end = { x: p.x + dx * reach, z: p.z + dz * reach }
    const t = flightSeconds(reach)
    const hoop = this.hoop
    const sunk = hoop !== null && p.spot.kind !== 'tyre' && reach > 1 && throughHoop(p, end, hoop)
    if (sunk && hoop) {
      end.x = hoop.x
      end.z = hoop.z
    }
    p.x = end.x
    p.z = end.z
    p.flyingUntil = now + t
    p.movedAt = now
    p.sunk = sunk
    this.host.tell(
      { kind: 'junk', i: p.spot.i, x: end.x, z: end.z, t, ...(sunk ? { hoop: true } : {}) },
      end,
    )
    this.host.alert({ x: end.x, y: p.spot.y, z: end.z }, JUNK_NOISE * (reach > 3 ? 1 : 0.6))
    if (sunk) {
      this.tally++
      this.host.scored(player, this.tally)
    }
    this.host.changed()
  }

  /** Back where it belongs. */
  private home(p: Piece): void {
    p.x = p.spot.x
    p.z = p.spot.z
    p.movedAt = null
    p.sunk = false
  }
}

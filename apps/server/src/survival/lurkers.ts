import {
  CAR_HALF_WIDTH,
  CHAT_MAX,
  type Notice,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
  ZombieKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Zed } from './horde.ts'

/**
 * The dead that wait instead of wander:
 *  - crawlers under the parked and wrecked cars, that take hold of an ankle going past and then
 *    drag themselves out after you;
 *  - mimics (night only, one or two in the world at most), that repeat something somebody said
 *    near them in the last few minutes, in a voice not quite right, to bring people closer. A
 *    torch in the face sends them off into the dark.
 */

/** Within this of a crawler under a car (m), it has your ankle. */
export const GRAB_RANGE = 1.5
/** Held this long (s), and hurt this much, before it lets go and crawls out. */
export const HOLD_SECONDS = 1
export const GRAB_DAMAGE = 12
/** Share of your walking speed while something has your ankle. */
export const HELD_SPEED = 0.05
/** Share of the cars something lies under (rolled again every LAIR_EPOCH seconds). */
const LAIR_SHARE = 0.3
const LAIR_EPOCH = 600
/** One is put under a car when somebody is within LAIR_NEAR (m), but nobody within LAIR_SEEN. */
const LAIR_NEAR = 70
const LAIR_SEEN = 25

/** Mimics at once in the whole world, and how often (s) the night rolls for a new one. */
export const MIMIC_MAX = 2
const MIMIC_ROLL_EVERY = 12
const MIMIC_CHANCE = 0.25
/** What it repeats: said within MIMIC_HEARD (m) of it, in the last MIMIC_MEMORY seconds. */
export const MIMIC_MEMORY = 240
export const MIMIC_HEARD = 60
/** How far its voice carries (m), and how often it speaks (s, the gap is picked between these). */
export const MIMIC_VOICE = 55
const MIMIC_SAY_EVERY: readonly [number, number] = [16, 28]
/** Who it seems to be in the chat. */
export const MIMIC_NAME = 'Unknown voice'
/** Nothing heard to repeat yet: it says what anybody would. */
const MIMIC_FALLBACK = ['help… over here', 'is someone there?', 'over here… please', "i'm hurt"]
/** A torch on it from within this (m), within this angle of the beam, sends it off running. */
const TORCH_RANGE = 24
const TORCH_COS = Math.cos((28 * Math.PI) / 180)
const FLEE_SECONDS = 6

/** Somebody alive, as the lurkers need them. */
export interface LurkerPerson {
  player: ServerPlayer
  /** Torch on. */
  light: boolean
  /** New and protected (newcomer.ts): nothing grabs them, no mimic comes for them. */
  shielded: boolean
  /** In a car (nothing under one reaches them), or in a safe place. */
  seated: boolean
  safe: boolean
}

/** What the lurkers need from the survival director. */
export interface LurkerHost {
  now(): number
  tick(): number
  random(): number
  night(): boolean
  /** The living (survivors). */
  people(): readonly LurkerPerson[]
  zed(id: number): Zed | undefined
  /** Cars nobody sits in (vehicles.ts hideouts). */
  cars(): readonly (Point & { yaw: number })[]
  ground(x: number, z: number): number
  /** A spot on the ground about `radius` from `centre`, away from people and places, or null. */
  ringSpot(centre: Point, radius: number): Point | null
  /** Brings out a free zombie of `kind` at `pos` facing `yaw` (null: none free). */
  bringOut(kind: ZombieKind, pos: Point, yaw: number): ServerPlayer | null
  retire(zombie: ServerPlayer): void
  hurt(victim: ServerPlayer, attacker: ServerPlayer, amount: number): void
  /** Their movement changed (held, let go): set their body up again. */
  rules(player: ServerPlayer): void
  clear(a: Point, b: Point): boolean
  send(player: ServerPlayer, msg: ServerMessage): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
}

interface Line {
  text: string
  x: number
  z: number
  /** When it was said (s). */
  at: number
}

interface Mimic {
  zombie: ServerPlayer
  /** When it next speaks (s). */
  sayAt: number
}

/**
 * A line of chat as a mimic says it back: lower case, words caught on, trailing off. Never
 * longer than a chat line.
 */
export function distort(text: string, random: () => number): string {
  const words = text
    .toLowerCase()
    .replace(/[!?.,;:]+$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10)
  const out = words.map((w, i) => {
    const r = random()
    if (r < 0.22 && /^[a-z]/.test(w)) return `${w[0]}-${w}`
    if (r < 0.36 && i < words.length - 1) return `${w}…`
    return w
  })
  return `${out.join(' ').slice(0, CHAT_MAX - 1)}…`
}

export class Lurkers {
  private readonly host: LurkerHost
  /** What people said out loud lately (nearby chat), oldest first. */
  private lines: Line[] = []
  /** Car index → the crawler under it. */
  private readonly lairs = new Map<number, ServerPlayer>()
  /** Cars whose crawler already came out (or was killed) this epoch. */
  private spent = new Set<number>()
  private epoch = -1
  /** Player id → who has their ankle, and until when (s). */
  private readonly held = new Map<number, { by: ServerPlayer; until: number }>()
  private readonly mimics = new Map<number, Mimic>()
  private rollAt = 0

  constructor(host: LurkerHost) {
    this.host = host
  }

  /** A new game (or map): nothing lies in wait yet. */
  reset(): void {
    this.lines = []
    this.lairs.clear()
    this.spent.clear()
    this.epoch = -1
    this.held.clear()
    this.mimics.clear()
    this.rollAt = 0
  }

  /** Somebody said `text` out loud at `at` (nearby chat): the mimics remember it. */
  heard(at: Point, text: string): void {
    const now = this.host.now()
    this.lines.push({ text, x: at.x, z: at.z, at: now })
    this.lines = this.lines.filter((l) => now - l.at < MIMIC_MEMORY).slice(-24)
  }

  /** The last thing said within MIMIC_HEARD of `at` in the last few minutes, or null. */
  lastHeard(at: { x: number; z: number }): string | null {
    const now = this.host.now()
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i] as Line
      if (now - l.at > MIMIC_MEMORY) break
      if (Math.hypot(l.x - at.x, l.z - at.z) <= MIMIC_HEARD) return l.text
    }
    return null
  }

  /** Something has this player's ankle: their speed (a share of walking), or null. */
  heldSpeed(player: ServerPlayer): number | null {
    return this.held.has(player.id) ? HELD_SPEED : null
  }

  /** How many mimics walk the world right now. */
  get mimicCount(): number {
    return this.mimics.size
  }

  /** One of the dead was killed: a crawler's car stays empty for now; a held ankle is let go. */
  killed(zombie: ServerPlayer): void {
    for (const [car, z] of this.lairs) {
      if (z !== zombie) continue
      this.lairs.delete(car)
      this.spent.add(car)
    }
    this.mimics.delete(zombie.id)
    for (const [id, h] of this.held) if (h.by === zombie) this.letGo(id)
  }

  /** Every tick. */
  step(): void {
    const tick = this.host.tick()
    if (tick % 3 === 0) {
      this.grabs()
      this.torches()
    }
    if (tick % TICK_RATE === 5) {
      this.hide()
      this.mimicNight()
      this.speak()
    }
  }

  /** Crawlers under cars take hold of whoever steps right by; held ankles are let go in time. */
  private grabs(): void {
    const now = this.host.now()
    const people = this.host.people()
    for (const [id, h] of this.held) {
      const who = people.find((p) => p.player.id === id)
      if (!who || now >= h.until || !h.by.state.alive) this.letGo(id)
    }
    for (const [car, zombie] of this.lairs) {
      const zed = this.host.zed(zombie.id)
      if (!zombie.state.alive || !zed?.lurking) {
        this.lairs.delete(car)
        continue
      }
      const me = zombie.state.pos
      const near = people.find(
        (p) =>
          !p.shielded &&
          !p.seated &&
          !this.held.has(p.player.id) &&
          Math.hypot(p.player.state.pos.x - me.x, p.player.state.pos.z - me.z) < GRAB_RANGE &&
          Math.abs(p.player.state.pos.y - me.y) < 1.5,
      )
      if (!near) continue
      // It has them: held for a moment, clawed at, then it drags itself out after them.
      this.lairs.delete(car)
      this.spent.add(car)
      zed.grab(near.player.id, near.player.state.pos, now, HOLD_SECONDS)
      this.held.set(near.player.id, { by: zombie, until: now + HOLD_SECONDS })
      this.host.rules(near.player)
      this.host.hurt(near.player, zombie, GRAB_DAMAGE)
      this.host.notice(near.player, 'warn', 'Something under the car has your ankle.')
    }
  }

  private letGo(id: number): void {
    const h = this.held.get(id)
    this.held.delete(id)
    const player = this.host.people().find((p) => p.player.id === id)?.player
    if (h && player) this.host.rules(player)
  }

  /** A torch full in a mimic's face: it runs. */
  private torches(): void {
    const now = this.host.now()
    const people = this.host.people().filter((p) => p.light)
    for (const m of this.mimics.values()) {
      const z = m.zombie
      const zed = this.host.zed(z.id)
      if (!z.state.alive || !zed || zed.fleeing) continue
      const me = z.state.pos
      for (const p of people) {
        const s = p.player.state
        const dx = me.x - s.pos.x
        const dz = me.z - s.pos.z
        const d = Math.hypot(dx, dz)
        if (d > TORCH_RANGE || d < 1e-3) continue
        const look = (-Math.sin(s.yaw) * dx - Math.cos(s.yaw) * dz) / d
        if (look < TORCH_COS) continue
        const eye = { x: s.pos.x, y: s.pos.y + 1.6, z: s.pos.z }
        if (!this.host.clear(eye, { x: me.x, y: me.y + 1.4, z: me.z })) continue
        zed.flee(s.pos, me, now, FLEE_SECONDS)
        break
      }
    }
  }

  /** Once a second: a crawler under each of the night's chosen cars somebody is coming up on. */
  private hide(): void {
    const now = this.host.now()
    const epoch = Math.floor(now / LAIR_EPOCH)
    if (epoch !== this.epoch) {
      this.epoch = epoch
      this.spent.clear()
    }
    const people = this.host.people().filter((p) => !p.shielded)
    if (people.length === 0) return
    this.host.cars().forEach((car, i) => {
      if (this.lairs.has(i) || this.spent.has(i) || !lairAt(i, epoch, LAIR_SHARE)) return
      const d = Math.min(
        ...people.map((p) =>
          Math.hypot(p.player.state.pos.x - car.x, p.player.state.pos.z - car.z),
        ),
      )
      if (d > LAIR_NEAR || d < LAIR_SEEN) return
      // Half under the sill, head and arms out, the rest of it under the car.
      const side = i % 2 === 0 ? 1 : -1
      const off = CAR_HALF_WIDTH + 0.45
      const dx = Math.cos(car.yaw) * side
      const dz = -Math.sin(car.yaw) * side
      const x = car.x + dx * off
      const z = car.z + dz * off
      const zombie = this.host.bringOut(
        ZombieKind.Walker,
        { x, y: this.host.ground(x, z), z },
        Math.atan2(-dx, -dz),
      )
      if (!zombie) return
      const zed = this.host.zed(zombie.id)
      if (!zed) return
      zed.mood = 'dead'
      zed.crawler = true
      zed.lurking = true
      this.lairs.set(i, zombie)
    })
  }

  /** At night now and then a mimic comes out near somebody; by day they slip away unseen. */
  private mimicNight(): void {
    const now = this.host.now()
    const people = this.host.people()
    for (const [id, m] of this.mimics) {
      const zed = this.host.zed(id)
      if (!m.zombie.state.alive || zed?.kind !== ZombieKind.Mimic) {
        this.mimics.delete(id)
        continue
      }
      if (this.host.night()) continue
      const seen = people.some((p) => dist(p.player.state.pos, m.zombie.state.pos) < 35)
      if (!seen) {
        this.mimics.delete(id)
        this.host.retire(m.zombie)
      }
    }
    if (!this.host.night() || this.mimics.size >= MIMIC_MAX || now < this.rollAt) return
    const out = people.filter((p) => !p.shielded && !p.safe && !p.seated)
    if (out.length === 0) return
    this.rollAt = now + MIMIC_ROLL_EVERY
    if (this.host.random() >= MIMIC_CHANCE) return
    const who = out[Math.floor(this.host.random() * out.length)]
    if (!who) return
    const pos = this.host.ringSpot(who.player.state.pos, 48 + this.host.random() * 10)
    if (!pos) return
    this.spawnMimic(pos)
  }

  /** A mimic, here (also for tests and the admin). */
  spawnMimic(pos: Point): ServerPlayer | null {
    const zombie = this.host.bringOut(ZombieKind.Mimic, pos, this.host.random() * Math.PI * 2)
    if (!zombie) return null
    const [lo, hi] = MIMIC_SAY_EVERY
    this.mimics.set(zombie.id, {
      zombie,
      sayAt: this.host.now() + 2 + this.host.random() * (hi - lo) * 0.3,
    })
    return zombie
  }

  /** Mimics with somebody in earshot say something back to them, now and then. */
  private speak(): void {
    const now = this.host.now()
    const people = this.host.people()
    const [lo, hi] = MIMIC_SAY_EVERY
    for (const m of this.mimics.values()) {
      const z = m.zombie
      const zed = this.host.zed(z.id)
      if (!z.state.alive || now < m.sayAt || zed?.mood === 'chase' || zed?.fleeing) continue
      const near = people.filter((p) => dist(p.player.state.pos, z.state.pos) < MIMIC_VOICE)
      // Nobody to hear it, or somebody already right on top of it: it keeps quiet.
      if (near.length === 0 || near.some((p) => dist(p.player.state.pos, z.state.pos) < 5)) continue
      m.sayAt = now + lo + this.host.random() * (hi - lo)
      const heard = this.lastHeard(z.state.pos)
      const said =
        heard ?? (MIMIC_FALLBACK[Math.floor(this.host.random() * MIMIC_FALLBACK.length)] as string)
      const text = distort(said, () => this.host.random())
      const msg: ServerMessage = {
        type: ServerMsg.Social,
        social: { kind: 'chat', from: z.id, name: MIMIC_NAME, text, channel: 'nearby' },
      }
      for (const p of near) this.host.send(p.player, msg)
    }
  }
}

/** Does something lie under car `i` this epoch? (Stable for the epoch, different each one.) */
export function lairAt(i: number, epoch: number, share: number): boolean {
  const h = Math.imul(i * 7919 + epoch * 104729 + 1, 2654435761) >>> 0
  return (h % 1000) / 1000 < share
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

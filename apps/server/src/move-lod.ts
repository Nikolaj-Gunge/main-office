import { Button, type InputCommand } from '@office-fps/shared'
import type { ServerPlayer } from './game.ts'

/**
 * Lightweight movement for the dead nobody is near (ROADMAP 0.5). Moving a body is a Rapier
 * character-controller sweep against the terrain heightfield — about 20 µs a sweep, two or more
 * a step, and by far the biggest cost of a tick with a full pool of the dead. A zombie further
 * than FAR from every person still thinks every tick, but its body only moves every `stride`
 * ticks, by `stride` ticks' worth, on the ticks snapshots go out: what clients see (and what lag
 * compensation rewinds to) is exactly as smooth as before. Anything a skipped command pressed is
 * carried into the next step, so no swing or jump is lost, only put off by a tick.
 */

/** Beyond this from every person (m), a zombie moves at snapshot rate… */
const FAR = 70
/** …and back to every tick once somebody comes within this. */
const NEAR = 60
/** How often (ticks) who-is-far is worked out again. */
const RECHECK = 15

/** Buttons that act on being pressed (a skipped press is carried to the next step). */
const EDGE = Button.Fire | Button.Jump | Button.Crouch | Button.Prone | Button.Use

export class MoveLod {
  private readonly far = new Set<number>()
  /** Buttons pressed by commands held back since a far zombie last moved. */
  private readonly held = new Map<number, number>()

  constructor(private readonly stride: number) {}

  /** Re-sorts the dead into near and far now and then (with a little give, so nobody flickers). */
  update(tick: number, players: Iterable<ServerPlayer>): void {
    if (this.stride <= 1 || tick % RECHECK !== 0) return
    const people: { x: number; z: number }[] = []
    const dead: ServerPlayer[] = []
    for (const p of players) {
      if (p.zombie && !steered(p)) dead.push(p)
      else if (!p.dummy) people.push(p.state.pos)
    }
    for (const z of dead) {
      const { x, z: zz } = z.state.pos
      let nearest = Number.POSITIVE_INFINITY
      for (const q of people) nearest = Math.min(nearest, (q.x - x) ** 2 + (q.z - zz) ** 2)
      const limit = this.far.has(z.id) ? NEAR : FAR
      const isFar = nearest > limit * limit && z.state.alive && !z.state.mantle
      if (isFar) this.far.add(z.id)
      else this.forget(z.id)
    }
    for (const id of this.far) if (!dead.some((z) => z.id === id)) this.forget(id)
  }

  /**
   * How many ticks `command` should move `player` by now: 1 for everyone near, `stride` for a far
   * zombie on a snapshot tick (with any held-back presses folded in), 0 to hold it back.
   */
  gate(player: ServerPlayer, command: InputCommand, tick: number): number {
    if (!this.far.has(player.id)) return 1
    if (steered(player) || !player.state.alive) {
      this.forget(player.id)
      return 1
    }
    const pressed = (this.held.get(player.id) ?? 0) | (command.buttons & EDGE)
    if (tick % this.stride !== 0) {
      this.held.set(player.id, pressed)
      return 0
    }
    this.held.delete(player.id)
    command.buttons |= pressed
    return this.stride
  }

  forget(id: number): void {
    this.far.delete(id)
    this.held.delete(id)
  }

  /** How many of the dead are on light movement right now (for stats). */
  get count(): number {
    return this.far.size
  }
}

/** A zombie one of the players is steering (turned-self.ts) always moves every tick. */
const steered = (p: ServerPlayer) => (p.zombie as { steered?: boolean } | undefined)?.steered

/** For tests: the thresholds. */
export const MOVE_LOD = { FAR, NEAR, RECHECK }

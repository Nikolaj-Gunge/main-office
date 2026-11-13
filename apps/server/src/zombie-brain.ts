import {
  Button,
  type InputCommand,
  type PlayerState,
  WEAPONS,
  WeaponId,
  ZombieKind,
} from '@office-fps/shared'
import type { Point } from './items.ts'

const EYE = 1.6
const CHEST = 1.25
/** Within this (m) and in plain sight, a zombie walks straight at you instead of pathing. */
const DIRECT_RANGE = 14
/** Seconds without real progress before it tries to jump and sidestep its way loose. */
const STUCK_SECONDS = 0.8

/** What a zombie needs from the world each tick. */
export interface ZombieSenses {
  /** The survivor it's after (feet), or null. */
  target: Point | null
  /** Next waypoint towards the nearest survivor along the nav grid, or null. */
  waypoint: Point | null
  /** Clear line between two points (walls, glass and shut gates block it). */
  clear: (a: Point, b: Point) => boolean
  /** Other zombies close by (feet), to keep a little apart. */
  crowd: readonly Point[]
}

/** Zombies closer than this to each other step apart (m). */
const PERSONAL_SPACE = 0.8

/**
 * One zombie: shambles (or, for runners, sprints) towards the nearest survivor along the nav
 * grid, straight at them once it can see them close by, and claws when in reach. No aiming
 * skill involved — it's the crowd that's dangerous. Each zombie leans a little to its own side
 * so a pack fans out instead of walking in single file.
 */
export class ZombieBrain {
  kind: ZombieKind
  private readonly random: () => number
  private seq = 1
  private yaw = 0
  private pitch = 0
  private swing = false
  private stuckFor = 0
  private unstickFor = 0
  private unstickSide = 1
  private lastPos = { x: 0, z: 0 }
  /** Personal approach angle (radians) so a pack spreads out. */
  private readonly lean: number

  constructor(kind: ZombieKind, random: () => number = Math.random) {
    this.kind = kind
    this.random = random
    this.lean = (random() * 2 - 1) * 0.35
  }

  /** Faces this way (just spawned). */
  face(yaw: number): void {
    this.yaw = yaw
    this.pitch = 0
    this.stuckFor = 0
  }

  think(self: PlayerState, senses: ZombieSenses, viewTick: number, dt: number): InputCommand {
    if (!self.alive) return this.command(0, viewTick)
    let buttons = 0
    const runner = this.kind === ZombieKind.Runner
    const { target } = senses
    const eye = { x: self.pos.x, y: self.pos.y + EYE, z: self.pos.z }

    // No way further along the grid (right under someone on a ramp, say): go straight at them.
    const waypoint = senses.waypoint
    const stalled =
      waypoint !== null && Math.hypot(waypoint.x - self.pos.x, waypoint.z - self.pos.z) < 0.5
    let goal: Point | null = stalled && target ? target : waypoint
    let flat = Number.POSITIVE_INFINITY
    let seen = false
    if (target) {
      const dx = target.x - self.pos.x
      const dz = target.z - self.pos.z
      flat = Math.hypot(dx, dz)
      if (flat < DIRECT_RANGE && Math.abs(target.y - self.pos.y) < 1.2) {
        seen = senses.clear(eye, { x: target.x, y: target.y + CHEST, z: target.z })
        if (seen) goal = target
      }
    }

    if (goal) {
      const dx = goal.x - self.pos.x
      const dz = goal.z - self.pos.z
      let want = Math.atan2(-dx, -dz)
      // Fan out on the approach; close in dead straight for the last couple of metres.
      if (seen && flat > 3) want += this.lean
      const pitch = seen && target ? Math.atan2(target.y + CHEST - eye.y, Math.max(flat, 0.1)) : 0
      this.turnTowards(want, pitch, (runner ? 9 : 6) * dt)
      if (!seen || flat > 1.1) buttons |= Button.Forward
      if (runner) buttons |= Button.Sprint
    }

    // Keep a little apart from the rest of the pack (nobody collides with anybody, so without
    // this they'd all end up standing inside each other): sidestep away, and let the one in
    // front go first when it's already at the target.
    let push = 0
    let ahead = false
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    for (const o of senses.crowd) {
      const ox = self.pos.x - o.x
      const oz = self.pos.z - o.z
      const d = Math.hypot(ox, oz)
      if (d > PERSONAL_SPACE || d < 1e-3) continue
      const weight = (PERSONAL_SPACE - d) / PERSONAL_SPACE
      push += ((ox * -fz + oz * fx) / d) * weight // + = the other one is on my left
      if ((-ox * fx - oz * fz) / d > 0.7) ahead = true
    }
    if (push > 0.15) buttons |= Button.Right
    else if (push < -0.15) buttons |= Button.Left
    if (ahead && seen && flat < 2.5) buttons &= ~Button.Forward

    // In reach: swing (a fresh click every other tick; the claws' own cooldown paces it).
    const reach = WEAPONS[WeaponId.Claws].range + 0.25
    if (seen && flat < reach) {
      this.swing = !this.swing
      if (this.swing) buttons |= Button.Fire
    }

    // Stuck on something: hop and sidestep for a moment.
    const moved = Math.hypot(self.pos.x - this.lastPos.x, self.pos.z - this.lastPos.z)
    this.lastPos = { x: self.pos.x, z: self.pos.z }
    const trying = (buttons & Button.Forward) !== 0
    this.stuckFor = trying && moved < 0.6 * dt ? this.stuckFor + dt : 0
    if (this.stuckFor > STUCK_SECONDS) {
      this.stuckFor = 0
      this.unstickFor = 0.5
      this.unstickSide = this.random() < 0.5 ? -1 : 1
      buttons |= Button.Jump
    }
    if (this.unstickFor > 0) {
      this.unstickFor -= dt
      buttons |= this.unstickSide > 0 ? Button.Right : Button.Left
    }
    return this.command(buttons, viewTick)
  }

  private command(buttons: number, viewTick: number): InputCommand {
    return { seq: this.seq++, buttons, yaw: this.yaw, pitch: this.pitch, viewTick }
  }

  private turnTowards(yaw: number, pitch: number, maxStep: number): void {
    let d = (yaw - this.yaw) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    this.yaw += Math.max(-maxStep, Math.min(maxStep, d))
    this.pitch += Math.max(-maxStep, Math.min(maxStep, pitch - this.pitch))
  }
}

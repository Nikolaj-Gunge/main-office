import {
  type BotSkill,
  Button,
  type InputCommand,
  type PhysicsWorld,
  PLAYER_QUERY_GROUPS,
  type PlayerState,
  RAPIER,
  type Vec3,
  WEAPONS,
  WeaponId,
} from '@office-fps/shared'

/** How a difficulty level plays. Angles in radians, times in seconds. */
interface Skill {
  /** Time from first seeing you to the first shot. */
  reaction: number
  /** Max turning speed. */
  turnRate: number
  /** Aim error when it starts tracking you; shrinks while it keeps tracking. */
  aimError: number
  /** Shoots only when its aim is within this of where it wants to aim. */
  fireCone: number
  /** Chance per target pick to aim for the head instead of the chest. */
  headshotChance: number
  /** How far it notices enemies (m). */
  sight: number
}

const SKILLS: Record<BotSkill, Skill> = {
  easy: {
    reaction: 1.1,
    turnRate: Math.PI * 0.8,
    aimError: 0.2,
    fireCone: 0.09,
    headshotChance: 0,
    sight: 28,
  },
  normal: {
    reaction: 0.7,
    turnRate: Math.PI * 1.4,
    aimError: 0.12,
    fireCone: 0.06,
    headshotChance: 0.05,
    sight: 42,
  },
  hard: {
    reaction: 0.4,
    turnRate: Math.PI * 2.4,
    aimError: 0.07,
    fireCone: 0.04,
    headshotChance: 0.15,
    sight: 60,
  },
}

/** Office-flavoured bot names (prefixed "Bot"). */
export const BOT_NAMES = [
  'Karen',
  'Steve',
  'Intern',
  'IT Guy',
  'Accounting',
  'HR',
  'The CEO',
  'Printer',
  'Coffee',
  'Deadline',
  'Monday',
  'Reply-All',
]

const EYE = 1.65
const CHEST = 1.3
const HEAD = 1.64
const LOOK_EVERY_TICKS = 6
const WANDER_PICKS = 10
const STUCK_SECONDS = 1.2

/** What a bot can know about another player. */
export interface BotView {
  id: number
  pos: { x: number; y: number; z: number }
  alive: boolean
  isProtected: boolean
  /** 0 = no teams; same non-zero team = friend. */
  team: number
}

/**
 * The brain of one server-side bot: turns what it sees into an input command each tick, like
 * a player's keyboard and mouse would. It sees only through clear lines of sight (glass blocks
 * it, as it blocks bullets), reacts after a delay, turns at a limited speed and aims with an
 * error that shrinks while it keeps tracking — so it plays fair and misses sometimes.
 */
export class BotBrain {
  skill: BotSkill
  private readonly physics: () => PhysicsWorld
  private readonly points: () => readonly Vec3[]
  private readonly random: () => number
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private seq = 1
  private yaw = 0
  private pitch = 0
  private tick = 0
  private target: number | null = null
  private targetSeenFor = 0
  private aimHead = false
  private errYaw = 0
  private errPitch = 0
  private wander: Vec3 | null = null
  private stuckFor = 0
  private lastPos = { x: 0, z: 0 }
  private strafe = 1
  private strafeFor = 0
  private fireToggle = false

  constructor(
    skill: BotSkill,
    physics: () => PhysicsWorld,
    points: () => readonly Vec3[],
    random: () => number = Math.random,
  ) {
    this.skill = skill
    this.physics = physics
    this.points = points
    this.random = random
  }

  /** The next input command for a bot in `self`'s state, given everyone else. */
  /** The bot's own team (0 = everyone is an enemy). */
  team = 0

  think(self: PlayerState, others: BotView[], viewTick: number, dt: number): InputCommand {
    const skill = SKILLS[this.skill]
    this.tick++
    let buttons = 0
    if (!self.alive) {
      this.target = null
      this.wander = null
      return this.command(0, viewTick)
    }

    // --- Who to fight: re-check line of sight a few times a second -------------------------
    if (this.tick % LOOK_EVERY_TICKS === 0) {
      const keep =
        this.target !== null &&
        others.some((o) => o.id === this.target && this.canFight(self, o, skill))
      if (!keep) {
        const next = this.nearestVisible(self, others, skill)
        if (next !== this.target) {
          this.target = next
          this.targetSeenFor = 0
          this.aimHead = this.random() < skill.headshotChance
          this.errYaw = (this.random() * 2 - 1) * skill.aimError
          this.errPitch = (this.random() * 2 - 1) * skill.aimError * 0.6
        }
      }
    }
    const enemy = others.find((o) => o.id === this.target)

    if (enemy) {
      this.targetSeenFor += dt
      // Aim error shrinks while tracking (it "settles" on you).
      const settle = Math.exp(-dt * 0.9)
      this.errYaw *= settle
      this.errPitch *= settle
      const aimY = enemy.pos.y + (this.aimHead ? HEAD : CHEST)
      const dx = enemy.pos.x - self.pos.x
      const dz = enemy.pos.z - self.pos.z
      const dy = aimY - (self.pos.y + EYE)
      const flat = Math.hypot(dx, dz)
      const wantYaw = Math.atan2(-dx, -dz) + this.errYaw
      const wantPitch = Math.atan2(dy, flat) + this.errPitch
      this.turnTowards(wantYaw, wantPitch, skill.turnRate * dt)
      const off = Math.hypot(angleDiff(wantYaw, this.yaw), wantPitch - this.pitch)

      // Strafe while fighting; close in from far, back off when very close.
      this.strafeFor -= dt
      if (this.strafeFor <= 0) {
        this.strafe = this.random() < 0.5 ? -1 : 1
        this.strafeFor = 0.5 + this.random() * 0.9
      }
      buttons |= this.strafe > 0 ? Button.Right : Button.Left
      const weapon = WEAPONS[self.weapon.id]
      const melee = weapon.fireMode === 'melee'
      const ideal = melee
        ? 1.2
        : weapon.id === WeaponId.Sniper
          ? 30
          : weapon.id === WeaponId.Shotgun
            ? 6
            : 14
      if (flat > ideal * 1.3) buttons |= Button.Forward | (melee ? Button.Sprint : 0)
      else if (flat < ideal * 0.5) buttons |= Button.Back
      if (!melee && (weapon.scoped || flat > 12)) buttons |= Button.Aim
      const inReach = !melee || flat < weapon.range + 0.3

      if (
        this.targetSeenFor >= skill.reaction &&
        off < skill.fireCone * (melee ? 3 : 1) &&
        inReach
      ) {
        // Automatic weapons: hold. Others need a fresh click each shot.
        if (weapon.fireMode === 'auto') buttons |= Button.Fire
        else {
          this.fireToggle = !this.fireToggle
          if (this.fireToggle) buttons |= Button.Fire
        }
      }
      return this.command(buttons, viewTick)
    }

    // --- Nobody in sight: roam the map ------------------------------------------------------
    const moved = Math.hypot(self.pos.x - this.lastPos.x, self.pos.z - this.lastPos.z)
    this.lastPos = { x: self.pos.x, z: self.pos.z }
    this.stuckFor = moved < 0.5 * dt ? this.stuckFor + dt : Math.max(0, this.stuckFor - dt)
    const there = this.wander
      ? Math.hypot(this.wander[0] - self.pos.x, this.wander[2] - self.pos.z) < 1.5
      : true
    if (!this.wander || there || this.stuckFor > STUCK_SECONDS) {
      if (this.stuckFor > STUCK_SECONDS) buttons |= Button.Jump
      this.wander = this.pickWander(self)
      this.stuckFor = 0
    }
    const w = this.wander
    if (w) {
      const dx = w[0] - self.pos.x
      const dz = w[2] - self.pos.z
      this.turnTowards(Math.atan2(-dx, -dz), 0, skill.turnRate * dt * 0.6)
      buttons |= Button.Forward
      if (Math.hypot(dx, dz) > 8 && self.weapon.reload === 0) buttons |= Button.Sprint
    }
    return this.command(buttons, viewTick)
  }

  private command(buttons: number, viewTick: number): InputCommand {
    return { seq: this.seq++, buttons, yaw: this.yaw, pitch: this.pitch, viewTick }
  }

  private turnTowards(yaw: number, pitch: number, maxStep: number): void {
    const dy = angleDiff(yaw, this.yaw)
    const dp = pitch - this.pitch
    const length = Math.hypot(dy, dp)
    const k = length > maxStep ? maxStep / length : 1
    this.yaw += dy * k
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dp * k))
  }

  private nearestVisible(self: PlayerState, others: BotView[], skill: Skill): number | null {
    let best: number | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const o of others) {
      if (!this.canFight(self, o, skill)) continue
      const d = Math.hypot(o.pos.x - self.pos.x, o.pos.y - self.pos.y, o.pos.z - self.pos.z)
      if (d < bestD) {
        bestD = d
        best = o.id
      }
    }
    return best
  }

  private canFight(self: PlayerState, o: BotView, skill: Skill): boolean {
    if (!o.alive || o.isProtected) return false
    if (this.team !== 0 && o.team === this.team) return false
    const d = Math.hypot(o.pos.x - self.pos.x, o.pos.y - self.pos.y, o.pos.z - self.pos.z)
    if (d > skill.sight) return false
    const from = { x: self.pos.x, y: self.pos.y + EYE, z: self.pos.z }
    return this.clear(from, { x: o.pos.x, y: o.pos.y + CHEST, z: o.pos.z })
  }

  /** A spot to walk to that it can see in a straight line (so it rarely walks into walls). */
  private pickWander(self: PlayerState): Vec3 | null {
    const points = this.points()
    if (points.length === 0) return null
    const from = { x: self.pos.x, y: self.pos.y + 0.6, z: self.pos.z }
    let fallback: Vec3 | null = null
    for (let i = 0; i < WANDER_PICKS; i++) {
      const p = points[Math.floor(this.random() * points.length)]
      if (!p) continue
      fallback ??= p
      const d = Math.hypot(p[0] - self.pos.x, p[2] - self.pos.z)
      if (d < 4 || d > 30 || Math.abs(p[1] - self.pos.y) > 0.5) continue
      if (this.clear(from, { x: p[0], y: p[1] + 0.6, z: p[2] })) return p
    }
    return fallback
  }

  /** Nothing (glass included — it stops bullets) between two points. */
  private clear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const length = Math.hypot(d.x, d.y, d.z)
    if (length < 0.01) return true
    this.ray.origin = a
    this.ray.dir = { x: d.x / length, y: d.y / length, z: d.z / length }
    return (
      this.physics().world.castRay(this.ray, length, true, undefined, PLAYER_QUERY_GROUPS) === null
    )
  }
}

/** Shortest signed difference a − b between two angles. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

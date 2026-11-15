import {
  CHALK_COOLDOWN,
  CHALK_PER_PLAYER,
  CHALK_PER_WORLD,
  CHALK_REACH,
  type ChalkMark,
  chalkFade,
  cleanChalk,
  type Notice,
  PERSON_QUERY_GROUPS,
  type PhysicsWorld,
  type PlayerState,
  RAPIER,
  type SurvivalSelf,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'

/**
 * Chalk marks (shared/survival/chalk.ts): a symbol and two words from fixed lists, chalked where
 * somebody looks and kept in the world's save. Anonymous to everyone else; each hand has a few
 * on the go (a new one rubs out their oldest) and the world keeps the newest CHALK_PER_WORLD.
 * Worn off after CHALK_LIFE_MS.
 */

/** A mark as the world's save keeps it: who chalked it (their account, or name), never sent. */
export interface ChalkSave extends ChalkMark {
  by: string
}

/** A spot on something solid, and the way its face points. */
export interface ChalkSpot {
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
}

export interface ChalkHost {
  /** The world's clock (s), for the pause between marks. */
  now(): number
  /** The real time (ms since 1970), for wearing off. */
  clock(): number
  /** Where `player` looks, on something solid within CHALK_REACH, or null. */
  aim(player: ServerPlayer): ChalkSpot | null
  /** Who they are for the per-hand cap (their account, or their name). */
  owner(player: ServerPlayer): string
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** The marks changed: everybody gets them again. */
  changed(): void
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Where somebody looks, on the map, the ground or a tree within CHALK_REACH (or null). */
export function aimChalk(physics: PhysicsWorld, s: PlayerState): ChalkSpot | null {
  const eye = { x: s.pos.x, y: s.pos.y + (s.crouched ? 1.05 : 1.6), z: s.pos.z }
  const dir = {
    x: -Math.sin(s.yaw) * Math.cos(s.pitch),
    y: Math.sin(s.pitch),
    z: -Math.cos(s.yaw) * Math.cos(s.pitch),
  }
  const ray = new RAPIER.Ray(eye, dir)
  const hit = physics.world.castRayAndGetNormal(
    ray,
    CHALK_REACH,
    true,
    undefined,
    PERSON_QUERY_GROUPS,
  )
  if (!hit) return null
  const t = hit.timeOfImpact
  return {
    x: eye.x + dir.x * t,
    y: eye.y + dir.y * t,
    z: eye.z + dir.z * t,
    nx: hit.normal.x,
    ny: hit.normal.y,
    nz: hit.normal.z,
  }
}

export class Chalk {
  private readonly host: ChalkHost
  private marks: ChalkSave[] = []
  private nextId = 1
  /** Bumped on every change; what each player was last sent. */
  private rev = 1
  private readonly sent = new Map<number, number>()
  private readonly lastAt = new Map<number, number>()

  constructor(host: ChalkHost) {
    this.host = host
  }

  get count(): number {
    return this.marks.length
  }

  /** Chalks a mark where `player` looks. True if it went on. */
  write(player: ServerPlayer, sym: unknown, word: unknown, place: unknown): boolean {
    if (!player.state.alive) return false
    const clean = cleanChalk(sym, word, place)
    if (!clean) return false
    const now = this.host.now()
    if (now < (this.lastAt.get(player.id) ?? -Infinity) + CHALK_COOLDOWN) return false
    const spot = this.host.aim(player)
    if (!spot) {
      this.host.notice(player, 'info', 'Nothing in reach to chalk on.')
      return false
    }
    this.lastAt.set(player.id, now)
    const by = this.host.owner(player)
    const mine = this.marks.filter((m) => m.by === by)
    // Their oldest is rubbed out to make room.
    if (mine.length >= CHALK_PER_PLAYER) {
      const drop = new Set(mine.slice(0, mine.length - CHALK_PER_PLAYER + 1))
      this.marks = this.marks.filter((m) => !drop.has(m))
    }
    this.marks.push({
      id: this.nextId++,
      x: r2(spot.x),
      y: r2(spot.y),
      z: r2(spot.z),
      nx: r2(spot.nx),
      ny: r2(spot.ny),
      nz: r2(spot.nz),
      ...clean,
      at: this.host.clock(),
      by,
    })
    if (this.marks.length > CHALK_PER_WORLD)
      this.marks.splice(0, this.marks.length - CHALK_PER_WORLD)
    this.bump()
    this.host.notice(player, 'info', 'You chalk your mark. Somebody may read it.')
    return true
  }

  /** Once in a while: the worn-off ones go. */
  prune(): void {
    const now = this.host.clock()
    const before = this.marks.length
    this.marks = this.marks.filter((m) => chalkFade(m.at, now) > 0)
    if (this.marks.length !== before) this.bump()
  }

  /** Puts the marks (without who made them) on what goes out to `player`, when changed. */
  attach(player: ServerPlayer, out: SurvivalSelf): void {
    if (this.sent.get(player.id) === this.rev) return
    this.sent.set(player.id, this.rev)
    out.chalk = this.marks.map(({ by: _by, ...m }) => m)
  }

  /** Somebody left: they get everything again next time. */
  forget(player: ServerPlayer): void {
    this.sent.delete(player.id)
    this.lastAt.delete(player.id)
  }

  save(): ChalkSave[] {
    return this.marks.map((m) => ({ ...m }))
  }

  restore(saved: unknown): void {
    this.marks = []
    if (!Array.isArray(saved)) return
    const now = this.host.clock()
    for (const m of saved as Partial<ChalkSave>[]) {
      if (!m || typeof m !== 'object') continue
      const clean = cleanChalk(m.sym, m.a, m.b)
      const nums = [m.x, m.y, m.z, m.nx, m.ny, m.nz, m.at]
      if (!clean || !nums.every((v) => typeof v === 'number' && Number.isFinite(v))) continue
      if (chalkFade(m.at as number, now) <= 0) continue
      this.marks.push({ ...(m as ChalkSave), ...clean, id: this.nextId++, by: String(m.by ?? '') })
    }
    if (this.marks.length > CHALK_PER_WORLD)
      this.marks.splice(0, this.marks.length - CHALK_PER_WORLD)
    this.bump()
  }

  private bump(): void {
    this.rev++
    this.host.changed()
  }
}

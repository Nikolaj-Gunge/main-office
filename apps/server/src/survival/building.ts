import {
  type Box,
  BUILD_REACH,
  BUILD_TURNS,
  countOf,
  decayPerSecond,
  emptyBox,
  give,
  KIT_PIECES,
  mapBlocks,
  type Notice,
  onPiece,
  type PhysicsWorld,
  PIECE_KINDS,
  PIECES,
  type Piece,
  type PieceKind,
  PLANK_ITEM,
  PLAYER_PIECES,
  packPieces,
  pieceAim,
  pieceBase,
  placeProblem,
  REPAIR_HP,
  SPIKE_DAMAGE,
  SPIKE_WEAR,
  STASH_SIZE,
  type Stored,
  type SurvivalDef,
  setBuilds,
  snapPiece,
  TICK_RATE,
  takeStack,
  WORLD_PIECES,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Zed } from './horde.ts'
import type { Worker } from './workbench.ts'

/** A piece as the world save keeps it (building.ts in shared has the rules). */
export interface SavedPiece {
  k: PieceKind
  x: number
  z: number
  r: number
  hp: number
  /** Whose it is (their account): only they take it down, only they open a stash. */
  owner: string
  open?: true
  box?: Stored[]
}

/** What building needs from the director. */
export interface BuildHost {
  def(): SurvivalDef
  physics(): PhysicsWorld
  now(): number
  /** Everybody in the game, the dead included. */
  players(): Iterable<ServerPlayer>
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** Their pockets changed: send and save them. */
  touch(w: Worker): void
  /** Hurts one of the dead (spikes), as `by`'s doing. */
  hurt(victim: ServerPlayer, by: ServerPlayer, amount: number): void
  drop(item: string, n: number, at: Point, ammo?: number): void
  openStash(w: Worker, id: number): void
  /** Hammering carries: the dead nearby hear it. */
  noise(w: Worker, loud: number, seconds: number): void
  /** Something everyone sees changed: tell them soon. */
  changed(): void
}

interface Built extends Piece {
  owner: string
  base: number
  /** Stash crates: what's in them. */
  box?: Box
}

/** Spot indices the dead batter (horde.ts `bashing`) above this are built pieces. */
export const BASH_BASE = 1_000_000

/** Whose a piece is: the account, or (no account, e.g. tests and bots) the name. */
export const ownerOf = (player: ServerPlayer): string => player.account ?? `name:${player.name}`

/**
 * Base building (see building.ts in shared): putting pieces up from kits, opening doors and
 * stashes, mending and taking things down, the dead battering walls and stepping on spikes, and
 * the weather slowly undoing it all.
 */
export class Building {
  private readonly host: BuildHost
  private readonly pieces = new Map<number, Built>()
  private nextId = 1
  /** When each of the dead may next be stabbed (player id → seconds). */
  private readonly stabAt = new Map<number, number>()
  private ticks = 0

  constructor(host: BuildHost) {
    this.host = host
  }

  get size(): number {
    return this.pieces.size
  }

  all(): Iterable<Piece> {
    return this.pieces.values()
  }

  get(id: number): Piece | undefined {
    return this.pieces.get(id)
  }

  /** A new world: nothing built. */
  reset(): void {
    this.pieces.clear()
    this.stabAt.clear()
    this.sync()
  }

  /** What the world save keeps. */
  save(): SavedPiece[] {
    return [...this.pieces.values()].map((p) => ({
      k: p.kind,
      x: p.x,
      z: p.z,
      r: p.rot,
      hp: Math.round(p.hp),
      owner: p.owner,
      ...(p.open ? { open: true as const } : {}),
      ...(p.box ? { box: p.box.items } : {}),
    }))
  }

  restore(saved: readonly SavedPiece[] | undefined): void {
    this.pieces.clear()
    const def = this.host.def()
    for (const s of saved ?? []) {
      if (!PIECE_KINDS.includes(s.k) || !(s.hp > 0) || this.pieces.size >= WORLD_PIECES) continue
      const p: Built = {
        id: this.nextId++,
        kind: s.k,
        x: Number(s.x),
        z: Number(s.z),
        rot: ((Math.round(Number(s.r)) % BUILD_TURNS) + BUILD_TURNS) % BUILD_TURNS,
        hp: Math.min(PIECES[s.k].hp, Number(s.hp)),
        owner: String(s.owner),
        base: 0,
      }
      p.base = pieceBase(def, p)
      if (s.open) p.open = true
      if (s.k === 'stash') p.box = { ...emptyBox(STASH_SIZE), items: [...(s.box ?? [])] }
      this.pieces.set(p.id, p)
    }
    this.sync()
  }

  /** For SurvivalShared.builds. */
  shared(): number[] {
    return packPieces(this.pieces.values())
  }

  /** Pieces somebody has standing. */
  countOf(owner: string): number {
    let n = 0
    for (const p of this.pieces.values()) if (p.owner === owner) n++
    return n
  }

  /** A stash crate: what's in it and where it stands (storage.ts). */
  stash(id: number): { box: Box; at: Point } | null {
    const p = this.pieces.get(id)
    if (!p?.box) return null
    return { box: p.box, at: { x: p.x, y: p.base, z: p.z } }
  }

  private sync(): void {
    setBuilds(this.host.physics(), this.host.def(), this.pieces.values())
  }

  // --- Putting things up ----------------------------------------------------------------------

  /** Puts a piece up from a kit in `w`'s pockets, if it may go there. True if it went up. */
  place(w: Worker, kit: string, x: number, z: number, rot: number): boolean {
    const { player, self } = w
    const kind = KIT_PIECES[kit]
    const fail = (text: string) => {
      this.host.notice(player, 'warn', text)
      return false
    }
    if (!kind || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rot)) return false
    const def = PIECES[kind]
    if (countOf(self.inv, kit) < 1) return fail(`You have no ${def.name.toLowerCase()} kit.`)
    const turns = ((Math.round(rot) % BUILD_TURNS) + BUILD_TURNS) % BUILD_TURNS
    const snapped = snapPiece(this.pieces.values(), { kind, x, z, rot: turns })
    const at = {
      kind,
      x: Math.round(snapped.x * 10) / 10,
      z: Math.round(snapped.z * 10) / 10,
      rot: snapped.rot,
    }
    const me = player.state.pos
    if (Math.hypot(at.x - me.x, at.z - me.z) > BUILD_REACH + 0.5) return fail('Too far away.')
    const owner = ownerOf(player)
    if (this.countOf(owner) >= PLAYER_PIECES)
      return fail(`You have ${PLAYER_PIECES} things standing already. Take one down first.`)
    if (this.pieces.size >= WORLD_PIECES) return fail("The woods are full of other people's junk.")
    const physics = this.host.physics()
    const problem = placeProblem(this.host.def(), this.pieces.values(), at, (p, base) =>
      mapBlocks(physics, p, base),
    )
    if (problem) return fail(problem)
    // Nobody standing where a wall would go up (they'd be nailed into it).
    if (kind !== 'spikes') {
      for (const p of this.host.players()) {
        if (p.state.alive && onPiece(at, p.state.pos.x, p.state.pos.z, 0.4))
          return fail("Something's in the way.")
      }
    }
    takeStack(self.inv, kit, 1)
    const piece: Built = { id: this.nextId++, ...at, hp: def.hp, owner, base: 0 }
    piece.base = pieceBase(this.host.def(), piece)
    if (kind === 'stash') piece.box = emptyBox(STASH_SIZE)
    this.pieces.set(piece.id, piece)
    this.sync()
    this.host.touch(w)
    this.host.noise(w, 24, 2)
    this.host.changed()
    return true
  }

  /** The piece `eye` looks at most squarely within reach, and how squarely (see onUse). */
  aimed(
    eye: Point,
    f: { x: number; y: number; z: number },
    reach = 2.6,
  ): { piece: Piece; score: number } | null {
    let best: { piece: Piece; score: number } | null = null
    for (const p of this.pieces.values()) {
      if (Math.abs(p.x - eye.x) > 6 || Math.abs(p.z - eye.z) > 6) continue
      const score = pieceAim(p, p.base, eye, f, reach)
      if (score > 0.5 && (!best || score > best.score)) best = { piece: p, score }
    }
    return best
  }

  /**
   * E at a piece: mend it with a plank if it's knocked about, open or shut a door, open your
   * stash. Crouching, the owner takes it down (the kit back if it was still sound).
   */
  use(w: Worker, id: number): void {
    const p = this.pieces.get(id)
    if (!p) return
    const { player, self } = w
    const def = PIECES[p.kind]
    const mine = p.owner === ownerOf(player)
    if (player.state.crouched) {
      if (!mine) return void this.host.notice(player, 'warn', 'Not yours to take down.')
      if (p.box && p.box.items.length > 0)
        return void this.host.notice(player, 'warn', 'Empty it first.')
      const sound = p.hp >= def.hp / 2
      const back = sound ? def.item : PLANK_ITEM
      const n = sound ? 1 : 2
      const got = give(self, back, n)
      if (got < n) this.host.drop(back, n - got, player.state.pos)
      this.remove(p)
      this.host.touch(w)
      return void this.host.notice(
        player,
        'info',
        sound
          ? `You take the ${def.name.toLowerCase()} down.`
          : 'It comes apart. Two planks saved.',
      )
    }
    // Mending: one plank at a time (doors and stashes once they're properly knocked about).
    const worn = p.kind === 'door' || p.kind === 'stash' ? p.hp < def.hp * 0.75 : p.hp < def.hp - 1
    if (worn && countOf(self.inv, PLANK_ITEM) > 0) {
      takeStack(self.inv, PLANK_ITEM, 1)
      p.hp = Math.min(def.hp, p.hp + REPAIR_HP)
      this.host.touch(w)
      this.host.noise(w, 24, 1.5)
      this.host.changed()
      return void this.host.notice(
        player,
        'info',
        `You nail a fresh plank on. (${Math.round((p.hp / def.hp) * 100)}%)`,
      )
    }
    if (p.kind === 'door') {
      p.open = !p.open
      this.sync()
      this.host.changed()
      return
    }
    if (p.kind === 'stash') {
      if (!mine) return void this.host.notice(player, 'warn', "Locked. Somebody else's.")
      return void this.host.openStash(w, p.id)
    }
    this.host.notice(
      player,
      'info',
      `${def.name}: ${Math.round((p.hp / def.hp) * 100)}% sound. Planks mend it; crouch + E to take it down.`,
    )
  }

  private remove(p: Built): void {
    this.pieces.delete(p.id)
    // A stash that falls apart spills what was in it.
    for (const s of p.box?.items ?? [])
      this.host.drop(s.item, s.n, { x: p.x, y: p.base, z: p.z }, s.ammo)
    this.sync()
    this.host.changed()
  }

  // --- The dead -------------------------------------------------------------------------------

  /**
   * A shut wall or door within arm's reach of `me` standing across the way to `goal`: the dead
   * batter it (horde.ts), as they do a boarded-up window.
   */
  blocking(me: Point, goal: Point): { index: number; x: number; z: number } | null {
    for (const p of this.pieces.values()) {
      if (p.kind === 'spikes' || p.kind === 'stash' || p.open) continue
      if (Math.abs(p.x - me.x) > 3 || Math.abs(p.z - me.z) > 3) continue
      const def = PIECES[p.kind]
      if (me.y > p.base + def.h || me.y + 1.8 < p.base) continue
      const yaw = (p.rot * Math.PI * 2) / BUILD_TURNS
      const ax = Math.cos(yaw)
      const az = -Math.sin(yaw)
      const nx = Math.sin(yaw)
      const nz = Math.cos(yaw)
      const across = (me.x - p.x) * nx + (me.z - p.z) * nz
      const along = (me.x - p.x) * ax + (me.z - p.z) * az
      if (Math.abs(across) > 1.4 || Math.abs(along) > def.w / 2 + 0.6) continue
      const goalAcross = (goal.x - p.x) * nx + (goal.z - p.z) * nz
      if (Math.sign(goalAcross) === Math.sign(across)) continue
      // Where the straight way to the goal crosses the wall's line: on the wall, or round it.
      const goalAlong = (goal.x - p.x) * ax + (goal.z - p.z) * az
      const t = across / (across - goalAcross)
      if (Math.abs(along + (goalAlong - along) * t) > def.w / 2 + 0.4) continue
      // Head for the nearest point of it.
      const at = Math.max(-def.w / 2 + 0.3, Math.min(def.w / 2 - 0.3, along))
      return { index: BASH_BASE + p.id, x: p.x + ax * at, z: p.z + az * at }
    }
    return null
  }

  /** One blow from the dead on the piece behind `index` (see blocking). */
  bash(index: number, damage: number): void {
    const p = this.pieces.get(index - BASH_BASE)
    if (!p) return
    p.hp -= damage
    if (p.hp <= 0) this.remove(p)
    else this.host.changed()
  }

  /** Every tick: spikes ten times a second, the weather once a second. */
  step(zombies: Iterable<ServerPlayer>): void {
    this.ticks++
    if (this.pieces.size === 0) return
    if (this.ticks % 6 === 0) this.spikes(zombies)
    if (this.ticks % TICK_RATE === 0) this.decay(1)
  }

  /** The dead on spike traps: slowed, stabbed now and then, and the spikes wear down. */
  private spikes(zombies: Iterable<ServerPlayer>): void {
    const now = this.host.now()
    for (const z of zombies) {
      const zed = z.zombie as Zed | undefined
      if (!zed) continue
      if (!z.state.alive) {
        zed.slowed = false
        continue
      }
      const { x, y, z: zz } = z.state.pos
      let on: Built | null = null
      for (const p of this.pieces.values()) {
        if (p.kind !== 'spikes' || Math.abs(p.x - x) > 2 || Math.abs(p.z - zz) > 2) continue
        if (Math.abs(y - p.base) < 1 && onPiece(p, x, zz, 0.15)) {
          on = p
          break
        }
      }
      zed.slowed = on !== null
      if (!on || now < (this.stabAt.get(z.id) ?? 0)) continue
      this.stabAt.set(z.id, now + 0.6)
      on.hp -= SPIKE_WEAR
      let by: ServerPlayer = z
      for (const p of this.host.players()) if (!p.zombie && ownerOf(p) === on.owner) by = p
      this.host.hurt(z, by, SPIKE_DAMAGE)
      if (on.hp <= 0) this.remove(on)
      else this.host.changed()
    }
  }

  /** `seconds` of weather: everything built loses a little, and what's rotten through falls. */
  decay(seconds: number): void {
    for (const p of [...this.pieces.values()]) {
      p.hp -= decayPerSecond(PIECES[p.kind].hp) * seconds
      if (p.hp <= 0) this.remove(p)
    }
  }
}

import {
  type Busy,
  bumpLife,
  countOf,
  craftPlan,
  type Have,
  ITEMS,
  type ItemDef,
  type ItemRef,
  type Notice,
  recipeOf,
  type SurvivalSelf,
  TICK_RATE,
  takeStack,
  traitFactor,
  useSeconds,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'

/** Anybody who can be busy: who they are and what they carry. */
export interface Worker {
  player: ServerPlayer
  self: SurvivalSelf
  dirty: boolean
}

/** What the workbench needs from the director. */
export interface WorkbenchHost {
  readonly tick: number
  /** Items in somebody's hands (weapons count as tools: a knife to whittle with). */
  inHands(player: ServerPlayer): string[]
  /** Sitting in a car. */
  seated(player: ServerPlayer): boolean
  /** Finishes using one of `item` at `ref`; false if it isn't there any more. */
  finishUse(w: Worker, ref: ItemRef, item: string): boolean
  giveOrDrop(w: Worker, item: string, n: number): void
  /** The pockets changed (guns see their ammo, the client is told). */
  touch(w: Worker): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** The dead within `r` of a point come to look. */
  alert(at: Point, r: number): void
  /** The ground's height (to land something thrown on). */
  groundAt(x: number, z: number): number
  /** How long using or making this takes them (× seconds; skills.ts). */
  pace?(w: Worker, kind: Busy['kind'], what: string): number
  /** They finished making this recipe. */
  made?(w: Worker, recipe: string): void
}

interface Job {
  w: Worker
  kind: Busy['kind']
  what: string
  ref?: ItemRef
  /** Ticks: started, and done at. */
  from: number
  ends: number
}

/** A noise maker ticking where it landed. */
interface Lure {
  at: Point
  until: number
  next: number
}

/** Faster than a walk on the ground: sprinting (m/s). */
const SPRINTING = 5.9
/** Going up faster than this off the ground: a jump (m/s). */
const JUMPING = 1.5
/** A noise maker lands this far ahead, rings this long (s), and carries this far (m). */
const THROW = 10
const LURE_SECONDS = 20
const LURE_RANGE = 50

/**
 * Use timers and crafting (see crafting.ts): eating, bandaging and making things take a few
 * seconds, done on the move. Nothing is used up until it's finished; sprinting, jumping, firing
 * or getting in a car gives it up. Also the noise makers somebody threw.
 */
export class Workbench {
  private readonly host: WorkbenchHost
  private readonly jobs = new Map<number, Job>()
  private lures: Lure[] = []

  constructor(host: WorkbenchHost) {
    this.host = host
  }

  /** What somebody carries, for a recipe. */
  have(w: Worker): Have {
    const hands = this.host.inHands(w.player)
    return {
      count: (item) => countOf(w.self.inv, item),
      holds: (item) => countOf(w.self.inv, item) > 0 || hands.includes(item),
    }
  }

  /** Starts using one of something (true), or false if it's done at once. */
  startUse(w: Worker, ref: ItemRef, def: ItemDef): boolean {
    const secs = useSeconds(def)
    if (secs <= 0) return false
    // Field Medic (legacy.ts): bandages and pills go on a little quicker.
    const medic = def.kind === 'med' ? traitFactor(w.self.trait, 'patch') : 1
    this.begin(w, 'use', def.id, secs * medic, ref)
    return true
  }

  /** Starts making something, if you have what it takes. */
  startCraft(w: Worker, id: string): void {
    const recipe = recipeOf(id)
    if (!recipe) return
    const plan = craftPlan(recipe, this.have(w))
    if (!plan.ok) {
      this.host.notice(w.player, 'warn', `You need ${plan.missing.join(', ')}.`)
      return
    }
    // Handy (legacy.ts): a little quicker at it.
    this.begin(w, 'craft', recipe.id, recipe.secs * traitFactor(w.self.trait, 'craft'))
  }

  private begin(w: Worker, kind: Busy['kind'], what: string, secs: number, ref?: ItemRef): void {
    this.jobs.delete(w.player.id)
    secs *= this.host.pace?.(w, kind, what) ?? 1
    const tick = this.host.tick
    const job: Job = { w, kind, what, from: tick, ends: tick + Math.round(secs * TICK_RATE) }
    if (ref) job.ref = ref
    this.jobs.set(w.player.id, job)
    w.self.busy = { kind, what, secs, left: secs }
    w.dirty = true
  }

  /** Busy with something? */
  busy(player: ServerPlayer): boolean {
    return this.jobs.has(player.id)
  }

  /** Gives up whatever they're busy with (`why`: what they're told). */
  stop(w: Worker, why?: string): void {
    if (!this.jobs.delete(w.player.id)) return
    w.self.busy = null
    w.dirty = true
    if (why) this.host.notice(w.player, 'info', why)
  }

  /** Forgets somebody who left. */
  forget(player: ServerPlayer): void {
    this.jobs.delete(player.id)
  }

  /** A gun went off in their hands. */
  onShot(w: Worker): void {
    if (this.jobs.has(w.player.id)) this.stop(w, 'Interrupted.')
  }

  /** Every tick: what's interrupted, what's done; the noise makers ring. */
  step(): void {
    const tick = this.host.tick
    for (const job of [...this.jobs.values()]) {
      const { w } = job
      const s = w.player.state
      if (!s.alive) {
        this.stop(w)
        continue
      }
      const speed = Math.hypot(s.vel.x, s.vel.z)
      if ((speed > SPRINTING && !s.crouched) || (!s.grounded && s.vel.y > JUMPING)) {
        this.stop(w, 'Interrupted. Stand still or walk while you do that.')
        continue
      }
      if (this.host.seated(w.player)) {
        this.stop(w)
        continue
      }
      if (tick >= job.ends) this.finish(job)
    }
    if (this.lures.length && tick % TICK_RATE === 0) {
      this.lures = this.lures.filter((l) => l.until > tick)
      for (const l of this.lures) {
        if (tick < l.next) continue
        l.next = tick + 2 * TICK_RATE
        this.host.alert(l.at, LURE_RANGE)
      }
    }
  }

  private finish(job: Job): void {
    const { w } = job
    this.jobs.delete(w.player.id)
    w.self.busy = null
    w.dirty = true
    if (job.kind === 'use') {
      if (job.ref && !this.host.finishUse(w, job.ref, job.what)) {
        this.host.notice(w.player, 'info', "It's not where it was.")
      }
      return
    }
    const recipe = recipeOf(job.what)
    if (!recipe) return
    const plan = craftPlan(recipe, this.have(w))
    if (!plan.ok) {
      this.host.notice(w.player, 'warn', `You no longer have ${plan.missing.join(', ')}.`)
      return
    }
    for (const [item, n] of plan.use) takeStack(w.self.inv, item, n)
    bumpLife(w.self, 'crafted')
    const made = recipe.makes
    this.host.giveOrDrop(w, made.item, made.n)
    this.host.made?.(w, recipe.id)
    this.host.notice(
      w.player,
      'loot',
      `+ ${ITEMS[made.item]?.name ?? made.item}${made.n > 1 ? ` ×${made.n}` : ''}`,
    )
  }

  /** A noise maker, wound and thrown ahead: the dead around where it lands go to it. */
  throwLure(w: Worker): void {
    const s = w.player.state
    const x = s.pos.x - Math.sin(s.yaw) * THROW
    const z = s.pos.z - Math.cos(s.yaw) * THROW
    const at = { x, y: Math.max(s.pos.y, this.host.groundAt(x, z)), z }
    const tick = this.host.tick
    this.lures.push({ at, until: tick + LURE_SECONDS * TICK_RATE, next: tick })
    this.host.notice(
      w.player,
      'info',
      'You wind it and throw it. Somewhere ahead, it starts to ring.',
    )
  }

  /** Noise makers still ringing (tests). */
  get ringing(): readonly { at: Point }[] {
    return this.lures
  }
}

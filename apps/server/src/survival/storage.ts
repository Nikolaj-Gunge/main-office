import {
  BOX_REACH,
  type Box,
  type BoxKind,
  boxFits,
  boxGive,
  boxStackAt,
  cloneBag,
  emptyBox,
  fitsAt,
  footprint,
  give,
  type Held,
  ITEMS,
  type ItemDest,
  type ItemRef,
  maxStack,
  type Notice,
  type Stack,
  type Stored,
  stackAt,
  TRUNK_REACH,
  TRUNK_SIZE,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Worker } from './workbench.ts'

/** Somebody who can open containers: and their locker, which is theirs for good. */
export interface Keeper extends Worker {
  locker: Box
}

/** What storage needs from the director. */
export interface StorageHost {
  /** Where the Haven locker stands (null: this map has none). */
  locker(): Point | null
  /** The car nearest `at` within `reach`: its id, and how often it has been replaced. */
  car(at: Point, reach: number): { id: number; generation: number } | null
  /** How often car `id` has been replaced (undefined: no such car). */
  generation(id: number): number | undefined
  /** Where car `id` is. */
  carAt(id: number): Point | null
  seated(player: ServerPlayer): boolean
  drop(w: Keeper, stack: Stack): void
  touch(w: Keeper): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
}

interface Opened {
  kind: BoxKind
  /** Trunks: which car. */
  car?: number
}

interface Trunk {
  generation: number
  box: Box
}

const NAMES: Record<BoxKind, string> = { locker: 'Your locker', trunk: 'Trunk' }

/**
 * Putting things into containers (see storage.ts in shared): car trunks, which keep what's in
 * them while the car stands, and each survivor's locker at Haven, which is saved with the
 * account and outlives the character. One container open at a time, while you're near it.
 */
export class Storage {
  private readonly host: StorageHost
  private readonly trunks = new Map<number, Trunk>()
  private readonly open = new Map<number, Opened>()

  constructor(host: StorageHost) {
    this.host = host
  }

  /** A new game: every trunk empty, nothing open. */
  reset(): void {
    this.trunks.clear()
    this.open.clear()
  }

  /** A car's trunk as it is now (empty again once the car was replaced). */
  trunk(id: number): Box | null {
    const generation = this.host.generation(id)
    if (generation === undefined) return null
    let t = this.trunks.get(id)
    if (!t || t.generation !== generation) {
      t = { generation, box: emptyBox(TRUNK_SIZE) }
      this.trunks.set(id, t)
    }
    return t.box
  }

  /** The inventory opened (or E at the locker): opens what's in reach. True if something did. */
  openNear(w: Keeper, only?: BoxKind): boolean {
    if (this.host.seated(w.player)) return false
    const pos = w.player.state.pos
    const locker = this.host.locker()
    if (locker && only !== 'trunk' && near(pos, locker, BOX_REACH)) {
      this.open.set(w.player.id, { kind: 'locker' })
      this.show(w)
      return true
    }
    if (only === 'locker') return false
    const car = this.host.car(pos, TRUNK_REACH)
    if (!car) return false
    this.open.set(w.player.id, { kind: 'trunk', car: car.id })
    this.show(w)
    return true
  }

  close(w: Keeper): void {
    if (!this.open.delete(w.player.id) && !w.self.box) return
    w.self.box = null
    w.dirty = true
  }

  forget(player: ServerPlayer): void {
    this.open.delete(player.id)
  }

  /** What `w` has open: the container itself. */
  private boxOf(w: Keeper): Box | null {
    const o = this.open.get(w.player.id)
    if (!o) return null
    if (o.kind === 'locker') return w.locker
    return o.car === undefined ? null : this.trunk(o.car)
  }

  /** Sends them what's in it. */
  private show(w: Keeper): void {
    const o = this.open.get(w.player.id)
    const box = this.boxOf(w)
    if (!o || !box) {
      this.close(w)
      return
    }
    w.self.box = { kind: o.kind, name: NAMES[o.kind], w: box.w, h: box.h, items: box.items }
    w.dirty = true
  }

  /** Once a second: walked away (or the car drove off, or was replaced) closes it. */
  check(w: Keeper): void {
    const o = this.open.get(w.player.id)
    if (!o) return
    const pos = w.player.state.pos
    const at = o.kind === 'locker' ? this.host.locker() : this.host.carAt(o.car ?? 0)
    const reach = o.kind === 'locker' ? BOX_REACH + 0.6 : TRUNK_REACH + 0.6
    if (!w.player.state.alive || !at || !near(pos, at, reach) || this.host.seated(w.player)) {
      this.close(w)
      return
    }
    // A trunk whose car was replaced is a new, empty one.
    if (o.kind === 'trunk' && w.self.box && w.self.box.items !== this.boxOf(w)?.items) this.show(w)
  }

  /**
   * Drag and drop into, out of or within the open container. Only between it and your pockets
   * (or the ground): clothes and weapons in hand go to your pockets first. True if it moved.
   */
  move(w: Keeper, from: ItemRef, to: ItemDest, want?: number): boolean {
    const box = this.boxOf(w)
    if (!box) return false
    const self = w.self
    const fail = (text: string) => {
      this.host.notice(w.player, 'warn', text)
      return false
    }
    // Where it comes from: the box, or a pocket.
    let item: string
    let have: number
    let ammo: number | undefined
    let stored: Stored | undefined
    let held: Held | undefined
    if ('box' in from) {
      stored = box.items.find((s) => s.x === from.x && s.y === from.y)
      if (!stored) return false
      ;({ item, n: have, ammo } = stored)
    } else if ('c' in from) {
      held = self.inv.find((s) => s.c === from.c && s.x === from.x && s.y === from.y)
      if (!held) return false
      ;({ item, n: have, ammo } = held)
    } else return fail('Put it in your pockets first.')
    const def = ITEMS[item]
    if (!def) return false
    let n = want === undefined ? have : Math.floor(Number(want))
    if (!(n >= 1)) return false
    n = Math.min(n, have)
    const max = maxStack(item)
    const extra = ammo !== undefined ? { ammo } : {}

    if ('box' in to) {
      if (to.x === undefined || to.y === undefined) {
        if (stored) return false
        const trial: Box = { ...box, items: box.items.map((s) => ({ ...s })) }
        n = boxGive(trial, item, n, ammo)
        if (n <= 0) return fail('No room for it in there.')
        box.items.splice(0, box.items.length, ...trial.items)
      } else {
        const onto = boxStackAt(box, to.x, to.y)
        if (onto && onto !== stored && onto.item === item && max > 1) {
          n = Math.min(n, max - onto.n)
          if (n <= 0) return false
          onto.n += n
        } else {
          n = Math.min(n, max)
          const [fw, fh] = footprint(item, to.r)
          const skip = stored && n === stored.n ? stored : undefined
          if (!boxFits(box, to.x, to.y, fw, fh, skip)) return fail("It doesn't fit there.")
          if (skip) {
            skip.x = to.x
            skip.y = to.y
            if (to.r === 1) skip.r = 1
            else delete skip.r
            this.show(w)
            return true
          }
          const put: Stored = { item, n, x: to.x, y: to.y, ...extra }
          if (to.r === 1) put.r = 1
          box.items.push(put)
        }
      }
    } else {
      if (!stored) return false
      if ('ground' in to) this.host.drop(w, { item, n, ...extra })
      else if ('auto' in to) {
        const bag = cloneBag(self)
        n = give(bag, item, n, ammo)
        if (n <= 0) return fail(`No room for the ${def.name}.`)
        self.inv = bag.inv
      } else if ('c' in to) {
        const onto = stackAt(self.inv, to.c, to.x, to.y)
        if (onto && onto.item === item && max > 1) {
          n = Math.min(n, max - onto.n)
          if (n <= 0) return false
          onto.n += n
        } else {
          n = Math.min(n, max)
          const [fw, fh] = footprint(item, to.r)
          if (!fitsAt(self, to.c, to.x, to.y, fw, fh)) return fail("It doesn't fit there.")
          const put: Held = { item, n, c: to.c, x: to.x, y: to.y, ...extra }
          if (to.r === 1) put.r = 1
          self.inv.push(put)
        }
      } else return fail('Put it in your pockets first.')
    }

    // Out of where it was.
    if (stored) {
      stored.n -= n
      if (stored.n <= 0) box.items.splice(box.items.indexOf(stored), 1)
    } else if (held) {
      held.n -= n
      if (held.n <= 0) self.inv.splice(self.inv.indexOf(held), 1)
    }
    this.show(w)
    this.host.touch(w)
    return true
  }
}

const near = (a: Point, b: Point, r: number) =>
  Math.hypot(a.x - b.x, a.z - b.z) <= r && Math.abs(a.y - b.y) < 2.5

import { footprint, maxStack, type Size, sizeOf } from './grid.ts'
import { ITEMS } from './items.ts'
import type { Stack } from './protocol.ts'

/**
 * Storage: things put away in a container that isn't you. A car's trunk (it keeps what's in it
 * for as long as that car stands there) and your locker in Haven's bunkhouse (it keeps what's in
 * it for good: dying doesn't empty it). Each is one grid, laid out like a pocket (grid.ts).
 */

/** A stack in a container: its top-left cell, turned on its side when r = 1. */
export interface Stored extends Stack {
  x: number
  y: number
  r?: 1
}

/** A stash crate is one somebody built out in the woods (building.ts): only they open it. */
export type BoxKind = 'locker' | 'trunk' | 'stash'

/** One container's grid and what's in it. */
export interface Box {
  w: number
  h: number
  items: Stored[]
}

/** The container somebody has open (sent with SurvivalSelf). */
export interface OpenBox extends Box {
  kind: BoxKind
  name: string
}

/** Your locker at Haven: big. */
export const LOCKER_SIZE: Size = [8, 10]
/** A car's trunk. */
export const TRUNK_SIZE: Size = [8, 4]
/** How close you stand to use a container (m). */
export const BOX_REACH = 3.2
/** A car's trunk is open to you this close to the car's middle (m). */
export const TRUNK_REACH = 4

export const emptyBox = ([w, h]: Size): Box => ({ w, h, items: [] })

/** The stack covering a cell, if any. */
export function boxStackAt(box: Box, x: number, y: number): Stored | undefined {
  return box.items.find((s) => {
    const [w, h] = footprint(s.item, s.r)
    return x >= s.x && x < s.x + w && y >= s.y && y < s.y + h
  })
}

const isCell = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Is a w × h box at (x, y) inside the container and clear of everything (`skip` aside)? */
export function boxFits(
  box: Box,
  x: number,
  y: number,
  w: number,
  h: number,
  skip?: Stored,
): boolean {
  if (!isCell(x) || !isCell(y) || x < 0 || y < 0 || x + w > box.w || y + h > box.h) return false
  for (const s of box.items) {
    if (s === skip) continue
    const [sw, sh] = footprint(s.item, s.r)
    if (x < s.x + sw && s.x < x + w && y < s.y + sh && s.y < y + h) return false
  }
  return true
}

/** The first place an item fits (flat, then on its side). */
export function boxSpot(box: Box, item: string): { x: number; y: number; r?: 1 } | null {
  const [w, h] = sizeOf(item)
  for (const r of w === h ? [0] : [0, 1]) {
    const [fw, fh] = r ? [h, w] : [w, h]
    for (let y = 0; y + fh <= box.h; y++)
      for (let x = 0; x + fw <= box.w; x++)
        if (boxFits(box, x, y, fw, fh)) return r ? { x, y, r: 1 } : { x, y }
  }
  return null
}

/** Puts up to `n` away (topping up stacks first). Returns how many went in. */
export function boxGive(box: Box, item: string, n: number, ammo?: number): number {
  if (n <= 0 || !ITEMS[item]) return 0
  const max = maxStack(item)
  let left = n
  if (max > 1) {
    for (const s of box.items) {
      if (left <= 0) break
      if (s.item !== item || s.n >= max) continue
      const add = Math.min(left, max - s.n)
      s.n += add
      left -= add
    }
  }
  while (left > 0) {
    const spot = boxSpot(box, item)
    if (!spot) break
    const take = Math.min(left, max)
    const s: Stored = { item, n: take, ...spot }
    if (ammo !== undefined) s.ammo = ammo
    box.items.push(s)
    left -= take
  }
  return n - left
}

/** A saved container made safe: things that no longer exist, or don't fit, are left out. */
export function cleanBox(items: unknown, size: Size): Box {
  const box = emptyBox(size)
  if (!Array.isArray(items)) return box
  for (const raw of items as Stored[]) {
    if (!raw || !ITEMS[raw.item] || !(raw.n >= 1)) continue
    const [w, h] = footprint(raw.item, raw.r)
    const s: Stored = { item: raw.item, n: Math.floor(raw.n), x: raw.x, y: raw.y }
    if (raw.r === 1) s.r = 1
    if (raw.ammo !== undefined) s.ammo = raw.ammo
    if (boxFits(box, s.x, s.y, w, h)) box.items.push(s)
    else boxGive(box, s.item, s.n, s.ammo)
  }
  return box
}

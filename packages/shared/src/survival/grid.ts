import { WEAPONS, type WeaponSlot } from '../sim/weapons.ts'
import { GEAR, type WearSlot } from './gear.ts'
import { ITEMS } from './items.ts'
import type { Held, Stack, SurvivalSelf } from './protocol.ts'

/**
 * The inventory as a grid, the DayZ way: every item takes up a few cells (a box of ammo one, a
 * can of beans one by two, a rifle six by two) and goes in the pockets of what you wear or in the
 * backpack. How much you can carry is how many pockets you have: a new character's tank top and
 * joggers hold next to nothing, a jacket, cargo pants and a rucksack hold a lot. The server
 * places and checks everything; the client uses the same arithmetic to show what would fit.
 */

/** What carries things: the clothes on your body and legs (their pockets), and the backpack. */
export type ContainerId = 'body' | 'legs' | 'pack'
/** Filled in this order when something is picked up: pockets first, then the pack. */
export const CONTAINERS: readonly ContainerId[] = ['body', 'legs', 'pack']

/** The paper doll: what you wear, the backpack and the three weapon slots (keys 1/2/3). */
export type EquipSlot = WearSlot | 'pack' | WeaponSlot

/** Where a thing is: a stack in a pocket or the pack (its top-left cell), worn or held, or on the ground nearby (loot id). */
export type ItemRef = { c: ContainerId; x: number; y: number } | { slot: EquipSlot } | { g: number }

/** Where to put it: a cell (r = 1 turns it on its side), a slot, the ground, or the first place it fits. */
export type ItemDest =
  | { c: ContainerId; x: number; y: number; r?: 0 | 1 }
  | { slot: EquipSlot }
  | { ground: true }
  | { auto: true }

/** You can take from (and drop onto) the ground this close (m, across; and up or down). */
export const VICINITY = 2.5
export const VICINITY_UP = 2.2

/** Cells wide and high. */
export type Size = readonly [w: number, h: number]

/** How many cells each item takes up, lying flat (r = 0). */
const SIZES: Record<string, Size> = {
  // Handguns and the sawn-off
  glock: [2, 2],
  m9: [2, 2],
  m1911: [2, 2],
  revolver: [3, 2],
  ruger: [3, 2],
  sawedoff: [4, 2],
  // Submachine guns
  mp5: [4, 2],
  uzi: [3, 2],
  ump: [4, 2],
  mac10: [3, 2],
  // Rifles and shotguns: long
  m4: [6, 2],
  ak47: [6, 2],
  sks: [7, 2],
  hunting: [7, 2],
  carbine22: [5, 2],
  lever: [6, 2],
  pump: [6, 2],
  doublebarrel: [6, 2],
  saiga: [6, 2],
  sniper: [8, 2],
  svd: [8, 2],
  barrett: [8, 3],
  m249: [7, 3],
  crossbow: [4, 3],
  // Melee: long and thin
  knife: [1, 2],
  bat: [1, 5],
  crowbar: [1, 4],
  machete: [1, 4],
  axe: [2, 5],
  sledge: [2, 5],
  katana: [1, 6],
  // Food
  beans: [1, 2],
  soup: [1, 2],
  tuna: [1, 1],
  peaches: [1, 2],
  chips: [2, 2],
  chocolate: [1, 1],
  jerky: [1, 1],
  energybar: [1, 1],
  mre: [2, 2],
  apple: [1, 1],
  dogfood: [1, 2],
  cereal: [2, 3],
  berries: [1, 1],
  // Drinks
  water: [1, 2],
  soda: [1, 2],
  energydrink: [1, 2],
  juice: [1, 1],
  coffee: [1, 2],
  beer: [1, 2],
  dirtywater: [1, 2],
  // Medical
  medkit: [2, 2],
  // Backpacks (on the ground or in another pack)
  pack_school: [3, 3],
  pack_hiking: [4, 4],
  pack_military: [4, 5],
  // Clothes
  cap: [2, 2],
  beanie: [2, 2],
  bandana: [1, 1],
  cowboyhat: [3, 2],
  hardhat: [2, 2],
  helmet: [3, 3],
  gasmask: [2, 2],
  hoodie: [3, 3],
  flannel: [3, 3],
  raincoat: [3, 3],
  jacket: [3, 3],
  camojacket: [3, 3],
  policevest: [3, 3],
  militaryvest: [4, 3],
  jeans: [3, 3],
  cargopants: [3, 3],
  camopants: [3, 3],
  worktrousers: [3, 3],
  policetrousers: [3, 3],
  sneakers: [2, 2],
  boots: [2, 2],
  militaryboots: [2, 3],
  // Junk and valuables
  scrap: [2, 2],
  electronics: [2, 1],
  planks: [1, 3],
  whiskey: [1, 2],
  toolkit: [3, 2],
  gasoline: [3, 3],
  // Car parts
  carbattery: [3, 2],
  sparkplugs: [1, 1],
  tyre: [3, 3],
  radiatorhose: [2, 1],
  // Quest things
  radio_board: [2, 2],
  research: [2, 2],
  sample: [2, 1],
  flare: [1, 2],
  teddy: [2, 2],
  toolbox: [3, 2],
}

/** How many go in one stack (everything not listed: one). */
const STACKS: Record<string, number> = {
  ammo9: 50,
  ammo45: 40,
  ammo357: 30,
  ammo22: 100,
  ammo556: 60,
  ammo762: 60,
  ammo308: 30,
  ammo50: 10,
  ammo12: 20,
  bolts: 10,
  rags: 6,
  bandage: 4,
  painkillers: 4,
  antibiotics: 3,
  berries: 10,
  cigarettes: 20,
  batteries: 4,
  planks: 8,
  scrap: 5,
  electronics: 3,
  ducttape: 3,
  cash: 1_000_000,
}

/** Pockets of the clothes you wear (cols × rows). Headgear and shoes have none. */
const POCKETS: Record<string, Size> = {
  hoodie: [3, 2],
  flannel: [2, 2],
  raincoat: [4, 2],
  jacket: [4, 3],
  camojacket: [5, 2],
  policevest: [3, 2],
  militaryvest: [4, 3],
  jeans: [3, 2],
  cargopants: [4, 2],
  camopants: [3, 2],
  worktrousers: [3, 2],
  policetrousers: [3, 2],
  pack_school: [5, 4],
  pack_hiking: [6, 6],
  pack_military: [8, 6],
}

/** What everyone starts in: a tank top with one tiny pocket and joggers with two small ones. */
export const STARTING_POCKETS: Readonly<Record<'body' | 'legs', Size>> = {
  body: [2, 1],
  legs: [2, 2],
}

/** How many cells an item takes up, lying flat. */
export function sizeOf(item: string): Size {
  const known = SIZES[item]
  if (known) return known
  // Something without an entry (added later): a guess from what it is.
  const def = ITEMS[item]
  if (def?.weapon !== undefined) {
    const slot = WEAPONS[def.weapon].slot
    return slot === 'sidearm' ? [2, 2] : slot === 'melee' ? [1, 4] : [6, 2]
  }
  if (def?.kind === 'wear') return [3, 3]
  if (def?.kind === 'pack') return [4, 4]
  return [1, 1]
}

/** The cells a stack covers as it lies (w, h). */
export function footprint(item: string, r?: number): Size {
  const [w, h] = sizeOf(item)
  return r ? [h, w] : [w, h]
}

/** How many of an item go in one stack (weapons never stack: they remember their ammo). */
export function maxStack(item: string): number {
  if (ITEMS[item]?.kind === 'weapon') return 1
  return STACKS[item] ?? 1
}

/** The pocket grid an item gives when worn (or a backpack on your back), or null for none. */
export function pocketsOf(item: string): Size | null {
  const known = POCKETS[item]
  if (known) return known
  // Clothes or packs added later: room from their old carrying figure (kg).
  const def = ITEMS[item]
  const kg = def?.kind === 'pack' ? def.capacity : GEAR[item]?.pockets
  if (!kg || kg <= 0) return null
  const cells = Math.max(2, Math.round(kg * 1.1))
  const w = Math.min(8, Math.max(2, Math.round(Math.sqrt(cells * 1.3))))
  return [w, Math.max(1, Math.ceil(cells / w))]
}

/** What carries things: what you wear and your backpack (all a grid needs to know). */
export type Bag = Pick<SurvivalSelf, 'inv' | 'wear' | 'pack'>

/** The grid of one container as you're dressed now, or null (no backpack). */
export function gridOf(bag: Pick<Bag, 'wear' | 'pack'>, c: ContainerId): Size | null {
  if (c === 'pack') return bag.pack ? pocketsOf(bag.pack) : null
  const worn = bag.wear?.[c]
  if (!worn) return STARTING_POCKETS[c]
  return pocketsOf(worn)
}

/** Which container a worn slot's pockets are (head and feet: none). */
export function containerOf(slot: EquipSlot): ContainerId | null {
  return slot === 'body' || slot === 'legs' || slot === 'pack' ? slot : null
}

/** The stack covering a cell, if any. */
export function stackAt(
  inv: readonly Held[],
  c: ContainerId,
  x: number,
  y: number,
): Held | undefined {
  return inv.find((s) => {
    if (s.c !== c) return false
    const [w, h] = footprint(s.item, s.r)
    return x >= s.x && x < s.x + w && y >= s.y && y < s.y + h
  })
}

const isCell = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/**
 * Is a w × h box at (x, y) inside container c and clear of everything in it (`skip` aside: the
 * stack being moved)?
 */
export function fitsAt(
  bag: Bag,
  c: ContainerId,
  x: number,
  y: number,
  w: number,
  h: number,
  skip?: Held,
): boolean {
  const grid = gridOf(bag, c)
  if (!grid || !isCell(x) || !isCell(y)) return false
  if (x < 0 || y < 0 || x + w > grid[0] || y + h > grid[1]) return false
  for (const s of bag.inv) {
    if (s === skip || s.c !== c) continue
    const [sw, sh] = footprint(s.item, s.r)
    if (x < s.x + sw && s.x < x + w && y < s.y + sh && s.y < y + h) return false
  }
  return true
}

/** The first place an item fits (lying flat, then on its side), container by container. */
export function findSpot(
  bag: Bag,
  item: string,
  only?: ContainerId,
): { c: ContainerId; x: number; y: number; r?: 1 } | null {
  const [w, h] = sizeOf(item)
  for (const c of only ? [only] : CONTAINERS) {
    const grid = gridOf(bag, c)
    if (!grid) continue
    for (const r of w === h ? [0] : [0, 1]) {
      const [fw, fh] = r ? [h, w] : [w, h]
      for (let y = 0; y + fh <= grid[1]; y++) {
        for (let x = 0; x + fw <= grid[0]; x++) {
          if (fitsAt(bag, c, x, y, fw, fh)) return r ? { c, x, y, r: 1 } : { c, x, y }
        }
      }
    }
  }
  return null
}

/**
 * Puts up to `n` of an item away: topping up stacks of it first, then new stacks wherever they
 * fit. Returns how many went in (the rest didn't fit).
 */
export function give(bag: Bag, item: string, n: number, ammo?: number): number {
  if (n <= 0 || !ITEMS[item]) return 0
  const max = maxStack(item)
  let left = n
  if (max > 1) {
    for (const s of bag.inv) {
      if (left <= 0) break
      if (s.item !== item || s.n >= max) continue
      const add = Math.min(left, max - s.n)
      s.n += add
      left -= add
    }
  }
  while (left > 0) {
    const spot = findSpot(bag, item)
    if (!spot) break
    const take = Math.min(left, max)
    const stack: Held = { item, n: take, ...spot }
    if (ITEMS[item]?.kind === 'weapon') stack.ammo = ammo ?? 0
    bag.inv.push(stack)
    left -= take
  }
  return n - left
}

/** How many of an item would still go in (money always does: it goes in your wallet). */
export function roomFor(bag: Bag, item: string): number {
  if (ITEMS[item]?.kind === 'money') return Number.POSITIVE_INFINITY
  return give(cloneBag(bag), item, 9999)
}

/** A copy to try things on: if it all works out, the copy becomes the real thing. */
export function cloneBag(bag: Bag): Bag {
  return { inv: bag.inv.map((s) => ({ ...s })), wear: { ...bag.wear }, pack: bag.pack }
}

/**
 * Takes out of container c everything that no longer fits it as you're dressed now (all of it
 * when it's gone): what was in the pockets of clothes just taken off, say. Returns them.
 */
export function loosen(bag: Bag, c: ContainerId): Stack[] {
  const grid = gridOf(bag, c)
  const out: Stack[] = []
  for (let i = bag.inv.length - 1; i >= 0; i--) {
    const s = bag.inv[i] as Held
    if (s.c !== c) continue
    const [w, h] = footprint(s.item, s.r)
    if (grid && s.x + w <= grid[0] && s.y + h <= grid[1]) continue
    bag.inv.splice(i, 1)
    out.unshift({ item: s.item, n: s.n, ...(s.ammo !== undefined ? { ammo: s.ammo } : {}) })
  }
  return out
}

/** Puts loose stacks back wherever they fit; returns what didn't. */
export function regive(bag: Bag, stacks: readonly Stack[]): Stack[] {
  const left: Stack[] = []
  for (const s of stacks) {
    const got = give(bag, s.item, s.n, s.ammo)
    if (got < s.n) left.push({ ...s, n: s.n - got })
  }
  return left
}

/** Cells used and cells there are in a container ("14/25"). */
export function cellsUsed(bag: Bag, c: ContainerId): { used: number; total: number } {
  const grid = gridOf(bag, c)
  let used = 0
  for (const s of bag.inv) {
    if (s.c !== c) continue
    const [w, h] = sizeOf(s.item)
    used += w * h
  }
  return { used, total: grid ? grid[0] * grid[1] : 0 }
}

/** Is this a well-formed reference to something you have, are wearing, or see on the ground? */
export function isItemRef(v: unknown): v is ItemRef {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if ('g' in o) return isCell(o.g)
  if ('slot' in o) return EQUIP_SLOTS.includes(o.slot as EquipSlot)
  return CONTAINERS.includes(o.c as ContainerId) && isCell(o.x) && isCell(o.y)
}

export function isItemDest(v: unknown): v is ItemDest {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.ground === true || o.auto === true) return true
  if ('slot' in o) return EQUIP_SLOTS.includes(o.slot as EquipSlot)
  return (
    CONTAINERS.includes(o.c as ContainerId) &&
    isCell(o.x) &&
    isCell(o.y) &&
    (o.r === undefined || o.r === 0 || o.r === 1)
  )
}

/** Every equipment slot. */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'head',
  'body',
  'legs',
  'feet',
  'pack',
  'primary',
  'sidearm',
  'melee',
]

/** Which equipment slot an item goes in, or null (it only goes in pockets). */
export function slotFor(item: string): EquipSlot | null {
  const def = ITEMS[item]
  if (!def) return null
  if (def.weapon !== undefined) return WEAPONS[def.weapon].slot
  if (def.kind === 'pack') return 'pack'
  return GEAR[item]?.slot ?? null
}

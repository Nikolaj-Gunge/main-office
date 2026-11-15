import { ITEMS, type ItemDef } from './items.ts'
import { MANUAL_READ_SECONDS } from './skills.ts'

/**
 * Making things out of junk, and how long using things takes. Everything is short (a few
 * seconds) and can be done on the move: start it from the inventory, close it and keep walking.
 * Sprinting, jumping or firing a gun stops it (nothing is used up until it's done).
 */

/** Some of one of these (the cheapest you carry is used). */
export interface Need {
  any: readonly string[]
  n: number
}

export interface Recipe {
  id: string
  name: string
  /** Seconds it takes. */
  secs: number
  needs: readonly Need[]
  /** Kept, not used up: one of each group must be on you (pockets or hands). */
  tools?: readonly (readonly string[])[]
  makes: { item: string; n: number }
}

const BLADES = ['knife', 'machete', 'axe', 'katana'] as const
const CLOTH = ['hoodie', 'flannel', 'jeans', 'cargopants', 'worktrousers', 'bandana'] as const

export const RECIPES: readonly Recipe[] = [
  {
    id: 'rags',
    name: 'Tear into rags',
    secs: 3,
    needs: [{ any: CLOTH, n: 1 }],
    makes: { item: 'rags', n: 4 },
  },
  {
    id: 'bandage',
    name: 'Bandage',
    secs: 3,
    needs: [{ any: ['rags'], n: 3 }],
    makes: { item: 'bandage', n: 1 },
  },
  {
    id: 'cleanbandages',
    name: 'Clean bandages',
    secs: 4,
    needs: [
      { any: ['rags'], n: 2 },
      { any: ['whiskey'], n: 1 },
    ],
    makes: { item: 'bandage', n: 3 },
  },
  {
    id: 'boilwater',
    name: 'Boil water',
    secs: 6,
    needs: [{ any: ['dirtywater'], n: 1 }],
    tools: [['lighter']],
    makes: { item: 'water', n: 1 },
  },
  {
    id: 'trailbars',
    name: 'Trail bars',
    secs: 2,
    needs: [
      { any: ['berries'], n: 3 },
      { any: ['cereal'], n: 1 },
    ],
    makes: { item: 'energybar', n: 2 },
  },
  {
    id: 'bolts',
    name: 'Crossbow bolts',
    secs: 5,
    needs: [
      { any: ['planks'], n: 1 },
      { any: ['scrap'], n: 1 },
    ],
    tools: [BLADES],
    makes: { item: 'bolts', n: 5 },
  },
  {
    id: 'barricadekit',
    name: 'Barricade kit',
    secs: 6,
    needs: [
      { any: ['planks'], n: 3 },
      { any: ['scrap'], n: 1 },
    ],
    makes: { item: 'barricadekit', n: 1 },
  },
  // Building (building.ts): scrap for nails and fittings, tape for hinges and hasps.
  {
    id: 'wallkit',
    name: 'Plank wall kit',
    secs: 6,
    needs: [
      { any: ['planks'], n: 3 },
      { any: ['scrap'], n: 1 },
    ],
    makes: { item: 'wallkit', n: 1 },
  },
  {
    id: 'doorkit',
    name: 'Door kit',
    secs: 8,
    needs: [
      { any: ['planks'], n: 4 },
      { any: ['scrap'], n: 1 },
      { any: ['ducttape'], n: 1 },
    ],
    makes: { item: 'doorkit', n: 1 },
  },
  {
    id: 'spikekit',
    name: 'Spike trap kit',
    secs: 6,
    needs: [
      { any: ['planks'], n: 2 },
      { any: ['scrap'], n: 2 },
    ],
    tools: [BLADES],
    makes: { item: 'spikekit', n: 1 },
  },
  {
    id: 'stashkit',
    name: 'Stash crate kit',
    secs: 7,
    needs: [
      { any: ['planks'], n: 3 },
      { any: ['scrap'], n: 1 },
      { any: ['ducttape'], n: 1 },
    ],
    makes: { item: 'stashkit', n: 1 },
  },
  {
    id: 'batteries',
    name: 'Rewired batteries',
    secs: 5,
    needs: [
      { any: ['electronics'], n: 2 },
      { any: ['ducttape'], n: 1 },
    ],
    makes: { item: 'batteries', n: 1 },
  },
  {
    id: 'noisemaker',
    name: 'Noise maker',
    secs: 4,
    needs: [
      { any: ['electronics'], n: 1 },
      { any: ['scrap'], n: 1 },
      { any: ['ducttape'], n: 1 },
    ],
    makes: { item: 'noisemaker', n: 1 },
  },
  {
    id: 'sparkplugs',
    name: 'Spark plugs',
    secs: 6,
    needs: [
      { any: ['scrap'], n: 1 },
      { any: ['electronics'], n: 1 },
    ],
    tools: [['toolkit', 'toolbox']],
    makes: { item: 'sparkplugs', n: 1 },
  },
  {
    id: 'bandana',
    name: 'Bandana',
    secs: 2,
    needs: [{ any: ['rags'], n: 2 }],
    makes: { item: 'bandana', n: 1 },
  },
  {
    id: 'satchel',
    name: 'Sewn satchel',
    secs: 8,
    needs: [
      { any: ['rags'], n: 4 },
      { any: ['ducttape'], n: 2 },
    ],
    makes: { item: 'pack_school', n: 1 },
  },
  {
    id: 'machete',
    name: 'Scrap machete',
    secs: 8,
    needs: [
      { any: ['scrap'], n: 2 },
      { any: ['planks'], n: 1 },
      { any: ['ducttape'], n: 1 },
    ],
    makes: { item: 'machete', n: 1 },
  },
]

const BY_ID = new Map(RECIPES.map((r) => [r.id, r]))

export function recipeOf(id: string): Recipe | undefined {
  return BY_ID.get(id)
}

/** What you have: how many of an item in your pockets, and whether a tool is on you at all. */
export interface Have {
  count(item: string): number
  holds(item: string): boolean
}

/** Which items (and how many of each) a recipe would use, or what's missing (names). */
export function craftPlan(
  recipe: Recipe,
  have: Have,
): { ok: true; use: [string, number][] } | { ok: false; missing: string[] } {
  const use: [string, number][] = []
  const missing: string[] = []
  const name = (id: string) => ITEMS[id]?.name ?? id
  for (const need of recipe.needs) {
    // The cheapest of the alternatives you carry enough of.
    const options = need.any
      .filter((id) => have.count(id) >= need.n)
      .sort((a, b) => (ITEMS[a]?.value ?? 0) - (ITEMS[b]?.value ?? 0))
    const pick = options[0]
    if (pick) use.push([pick, need.n])
    else missing.push(`${need.n > 1 ? `${need.n}× ` : ''}${need.any.map(name).join(' / ')}`)
  }
  for (const group of recipe.tools ?? []) {
    if (!group.some((id) => have.holds(id))) missing.push(group.map(name).join(' / '))
  }
  return missing.length ? { ok: false, missing } : { ok: true, use }
}

/** Seconds using one of something takes (0: at once). */
export function useSeconds(def: ItemDef): number {
  if (def.battery) return 1
  if (def.manual) return MANUAL_READ_SECONDS
  if (def.kind === 'food') return 2
  if (def.kind === 'drink') return 1.5
  if (def.kind !== 'med') return 0
  if (def.id === 'medkit') return 5
  if (def.id === 'bandage' || def.id === 'rags') return 3
  if (def.id === 'cure') return 2
  // Shots and pills.
  return 1
}

/** Somebody busy using or making something (sent with SurvivalSelf). */
export interface Busy {
  kind: 'use' | 'craft'
  /** The item being used, or the recipe being made. */
  what: string
  /** Seconds it takes in all, and how many were left when this was sent. */
  secs: number
  left: number
}

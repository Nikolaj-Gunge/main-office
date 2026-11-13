import { type AmmoType, WEAPONS, WeaponId } from '../sim/weapons.ts'

/**
 * Everything you can carry in survival mode. Items are plain data: the server owns what they
 * do, the client shows them. Weights are kilograms, values are what the trader charges ($).
 */

export type ItemKind =
  | 'weapon'
  | 'ammo'
  | 'food'
  | 'drink'
  | 'med'
  | 'pack'
  | 'tool'
  | 'junk'
  | 'quest'
  | 'money'

export interface ItemDef {
  id: string
  name: string
  kind: ItemKind
  /** Kilograms each. */
  weight: number
  /** What the trader sells it for; they buy at SELL_RATE of that. */
  value: number
  desc: string
  /** Weapons: which one. */
  weapon?: WeaponId
  /** Ammo: for which guns. */
  ammo?: AmmoType
  /** Using it: what it gives back (0–100 scales; health in points). */
  health?: number
  hunger?: number
  thirst?: number
  stamina?: number
  /** Using it stops bleeding. */
  stopsBleeding?: boolean
  /** Backpacks: how much you can carry with it on (kg). */
  capacity?: number
  /** Batteries: recharges the torch (0–100). */
  battery?: number
  /** Money: dollars each. */
  cash?: number
}

/** The trader pays this share of an item's value. */
export const SELL_RATE = 0.4
/** What your pockets hold without a backpack (kg). */
export const POCKETS_KG = 9

const defs: ItemDef[] = []
const add = (def: ItemDef) => {
  defs.push(def)
  return def
}

// ── Weapons: one item per survival weapon ──
const WEAPON_ITEMS: [WeaponId, string, number, number, string][] = [
  [WeaponId.Handgun, 'glock', 0.9, 180, 'Glock 17. Twelve in the magazine, if you have twelve.'],
  [WeaponId.M9, 'm9', 1, 220, 'Beretta M9. Fifteen rounds of 9mm.'],
  [WeaponId.M1911, 'm1911', 1.1, 260, 'Seven fat .45s. Each one counts.'],
  [WeaponId.Revolver, 'revolver', 1.2, 380, 'Six shots of .357. Loud enough to wake the county.'],
  [WeaponId.Ruger, 'ruger', 1, 320, 'Suppressed .22 pistol. Weak, but nothing hears it.'],
  [WeaponId.SawedOff, 'sawedoff', 2, 300, 'Two barrels, no stock. Fits where a pistol goes.'],
  [WeaponId.Smg, 'mp5', 2.9, 520, 'MP5. Thirty rounds of 9mm, fast.'],
  [WeaponId.Uzi, 'uzi', 3.2, 420, 'Sprays 9mm in the general direction of trouble.'],
  [WeaponId.Ump, 'ump', 2.6, 560, 'UMP45. Slower, hits harder.'],
  [WeaponId.Mac10, 'mac10', 2.8, 400, 'Empties thirty .45s before you can blink.'],
  [WeaponId.Rifle, 'm4', 3.3, 800, 'M4 carbine. 5.56, thirty to a magazine.'],
  [WeaponId.Ak47, 'ak47', 3.8, 760, 'AK-47. 7.62. Kicks like it hates you.'],
  [WeaponId.Sks, 'sks', 3.9, 520, 'Ten rounds of 7.62, one pull at a time.'],
  [WeaponId.HuntingRifle, 'hunting', 3.6, 480, 'Bolt-action .308 with good glass.'],
  [WeaponId.Carbine22, 'carbine22', 2.3, 300, 'Ruger 10/22. Quiet little squirrel gun.'],
  [WeaponId.LeverAction, 'lever', 3.2, 440, 'Cowboy rifle in .357. Eight in the tube.'],
  [WeaponId.Shotgun, 'pump', 3.4, 480, 'Pump-action 12 gauge. Six shells.'],
  [WeaponId.DoubleBarrel, 'doublebarrel', 3.1, 340, "Grandpa's side-by-side. Two tries."],
  [WeaponId.AutoShotgun, 'saiga', 3.7, 900, 'Saiga-12. Eight shells as fast as you can pull.'],
  [WeaponId.Sniper, 'sniper', 5.5, 1100, 'Scoped .308. One shot, one problem fewer.'],
  [WeaponId.Svd, 'svd', 4.4, 1300, 'Dragunov. Scoped 7.62, ten rounds, semi-automatic.'],
  [WeaponId.Barrett, 'barrett', 13.5, 3000, 'Fifty calibre. It kills whatever it points at.'],
  [WeaponId.Lmg, 'm249', 8.5, 1800, 'M249. A hundred rounds on a belt.'],
  [WeaponId.Crossbow, 'crossbow', 3, 420, 'Silent. One bolt at a time.'],
  [WeaponId.Knife, 'knife', 0.3, 40, 'A kitchen knife. From behind, it only takes one.'],
  [WeaponId.Bat, 'bat', 0.9, 50, 'Louisville Slugger. Home run.'],
  [WeaponId.Crowbar, 'crowbar', 1.6, 70, 'Opens crates and skulls.'],
  [WeaponId.Machete, 'machete', 0.7, 140, 'Long, sharp, quiet.'],
  [WeaponId.Axe, 'axe', 2.6, 180, 'Fire axe. Break glass in case of the dead.'],
  [WeaponId.Sledge, 'sledge', 5.5, 160, 'Slow. Nothing gets up from it.'],
  [WeaponId.Katana, 'katana', 1.1, 900, 'Somebody collected swords. Lucky you.'],
]
for (const [weapon, id, weight, value, desc] of WEAPON_ITEMS) {
  add({ id, name: WEAPONS[weapon].name, kind: 'weapon', weight, value, desc, weapon })
}

// ── Ammunition (weight and value per round) ──
const AMMO_ITEMS: [AmmoType, string, string, number, number][] = [
  ['9mm', 'ammo9', '9mm rounds', 0.012, 3],
  ['.45', 'ammo45', '.45 ACP rounds', 0.021, 4],
  ['.357', 'ammo357', '.357 Magnum rounds', 0.016, 6],
  ['.22', 'ammo22', '.22 LR rounds', 0.004, 1.5],
  ['5.56', 'ammo556', '5.56 rounds', 0.012, 5],
  ['7.62', 'ammo762', '7.62 rounds', 0.017, 5],
  ['.308', 'ammo308', '.308 rounds', 0.025, 9],
  ['.50', 'ammo50', '.50 BMG rounds', 0.12, 60],
  ['12ga', 'ammo12', '12-gauge shells', 0.045, 6],
  ['bolt', 'bolts', 'Crossbow bolts', 0.03, 8],
]
for (const [ammo, id, name, weight, value] of AMMO_ITEMS) {
  add({ id, name, kind: 'ammo', weight, value, ammo, desc: `Fits anything chambered in ${ammo}.` })
}

// ── Food ──
const food = (
  id: string,
  name: string,
  hunger: number,
  weight: number,
  value: number,
  desc: string,
  extra: Partial<ItemDef> = {},
) => add({ id, name, kind: 'food', hunger, weight, value, desc, ...extra })
food('beans', 'Canned beans', 30, 0.45, 18, 'Cold beans. Best meal this week.')
food('soup', 'Canned soup', 26, 0.45, 16, 'Chicken noodle, allegedly.', { thirst: 8 })
food('tuna', 'Canned tuna', 22, 0.2, 14, 'Dolphin friendly. Zombie neutral.')
food('peaches', 'Canned peaches', 20, 0.45, 20, 'In syrup. Worth dying for.', { thirst: 10 })
food('chips', 'Bag of chips', 12, 0.1, 8, 'Loud to open. Louder to eat.')
food('chocolate', 'Chocolate bar', 14, 0.08, 12, 'A little hope in a wrapper.', { stamina: 30 })
food('jerky', 'Beef jerky', 24, 0.12, 22, 'Chewy. Keeps forever.', { thirst: -6 })
food('energybar', 'Energy bar', 18, 0.07, 14, 'Tastes like cardboard that believes in you.', {
  stamina: 40,
})
food('mre', 'MRE', 60, 0.7, 60, 'Meal, Ready-to-Eat. Three lies in one name.', { thirst: 5 })
food('apple', 'Apple', 10, 0.18, 6, 'Slightly bruised.', { thirst: 6 })
food('dogfood', 'Dog food', 22, 0.4, 5, "Don't think about it.")
food('cereal', 'Box of cereal', 20, 0.35, 12, 'Stale. Still part of a complete breakfast.')
food('berries', 'Wild berries', 6, 0.05, 3, 'Probably the safe kind.', { thirst: 4 })

// ── Drinks ──
const drink = (
  id: string,
  name: string,
  thirst: number,
  weight: number,
  value: number,
  desc: string,
  extra: Partial<ItemDef> = {},
) => add({ id, name, kind: 'drink', thirst, weight, value, desc, ...extra })
drink('water', 'Water bottle', 40, 0.55, 15, 'Clean water. More precious than bullets.')
drink('soda', 'Soda can', 22, 0.36, 10, 'Flat and warm.', { hunger: 4 })
drink(
  'energydrink',
  'Energy drink',
  18,
  0.28,
  18,
  'Your heart will be the loudest thing in the forest.',
  { stamina: 100 },
)
drink('juice', 'Juice box', 20, 0.22, 8, 'Apple. Comes with a tiny straw.', { hunger: 3 })
drink('coffee', 'Thermos of coffee', 24, 0.5, 25, 'Still warm, somehow.', { stamina: 60 })
drink('beer', 'Bottle of beer', 14, 0.5, 12, 'For courage.', { health: 3 })
drink('dirtywater', 'Dirty water', 28, 0.55, 2, "It'll do. It'll also do something to you.", {
  health: -8,
})

// ── Medical ──
const med = (
  id: string,
  name: string,
  weight: number,
  value: number,
  desc: string,
  extra: Partial<ItemDef>,
) => add({ id, name, kind: 'med', weight, value, desc, ...extra })
med('rags', 'Clean rags', 0.05, 6, 'Better than bleeding.', { stopsBleeding: true })
med('bandage', 'Bandage', 0.06, 25, 'Stops bleeding and patches you up a little.', {
  stopsBleeding: true,
  health: 12,
})
med('medkit', 'First aid kit', 0.9, 140, 'Everything short of a doctor.', {
  stopsBleeding: true,
  health: 70,
})
med('painkillers', 'Painkillers', 0.05, 40, "You'll feel it tomorrow instead.", { health: 22 })
med('antibiotics', 'Antibiotics', 0.05, 90, 'Rare now. People kill for these.', { health: 35 })
med('adrenaline', 'Adrenaline shot', 0.05, 110, 'Run now, pay later.', { health: 15, stamina: 100 })

// ── Backpacks ──
const pack = (
  id: string,
  name: string,
  capacity: number,
  weight: number,
  value: number,
  desc: string,
) => add({ id, name, kind: 'pack', capacity, weight, value, desc })
pack('pack_school', 'School backpack', 18, 0.4, 120, 'Has a name written inside. Carries 18 kg.')
pack('pack_hiking', 'Hiking backpack', 30, 0.9, 380, 'Frame and hip belt. Carries 30 kg.')
pack('pack_military', 'Military rucksack', 45, 1.6, 900, 'Built to carry a war. Carries 45 kg.')

// ── Tools ──
add({
  id: 'batteries',
  name: 'Batteries',
  kind: 'tool',
  weight: 0.1,
  value: 30,
  battery: 100,
  desc: 'Fresh light for your torch.',
})

// ── Junk: only good for selling ──
const junk = (id: string, name: string, weight: number, value: number, desc: string) =>
  add({ id, name, kind: 'junk', weight, value, desc })
junk('scrap', 'Scrap metal', 0.8, 14, 'The camp can always use it.')
junk('ducttape', 'Duct tape', 0.2, 22, 'Holds the world together.')
junk('electronics', 'Electronics', 0.3, 35, 'Circuit boards and wire.')
junk('cigarettes', 'Cigarettes', 0.03, 28, 'Currency with a warning label.')
junk('lighter', 'Lighter', 0.03, 12, 'Half full.')
junk('watch', 'Wristwatch', 0.1, 70, 'Stopped at 3:17.')
junk('ring', 'Gold ring', 0.01, 160, 'Engraved: "Forever".')
junk('necklace', 'Silver necklace', 0.03, 110, "Still warm. No, it isn't.")
junk('whiskey', 'Bottle of whiskey', 0.9, 85, 'The trader pays well for this.')
junk('toolkit', 'Small toolkit', 1.4, 90, 'Screwdrivers, pliers, a wrench.')
junk('gasoline', 'Jerry can', 4.5, 120, 'Sloshes. Smells like the old world.')
add({
  id: 'cash',
  name: 'Cash',
  kind: 'money',
  weight: 0,
  value: 1,
  cash: 1,
  desc: 'Still worth something at Haven.',
})

// ── Quest items ──
const quest = (id: string, name: string, weight: number, desc: string) =>
  add({ id, name, kind: 'quest', weight, value: 0, desc })
quest('radio_tube', 'Vacuum tube', 0.1, 'For an old transmitter. Fragile.')
quest('radio_board', 'Transmitter board', 0.4, 'Pulled from a police radio.')
quest('fuse', 'Heavy fuse', 0.3, 'Industrial. Rated for a generator.')
quest('keycard_blue', 'Blue keycard', 0.01, 'SITE 7 — LEVEL 1. There is blood on the lanyard.')
quest('keycard_red', 'Red keycard', 0.01, 'SITE 7 — LEVEL 2. Dr. E. Voss.')
quest(
  'research',
  "Voss's research notes",
  0.6,
  'Pages of formulas and one line underlined three times.',
)
quest('sample', 'Serum sample', 0.2, 'A steel case, cold to the touch.')
quest('flare', 'Signal flare', 0.3, 'Red. Seen for miles.')
quest('teddy', 'Teddy bear', 0.3, 'One eye missing. Somebody misses it.')
quest('photo', 'Family photo', 0.01, 'Four people on a porch, smiling.')
quest('dogtags', 'Dog tags', 0.02, 'Somebody should know what happened to them.')
quest('insulin', 'Insulin', 0.1, 'Keep cold. Keep hidden.')
quest('seeds', 'Seed packets', 0.1, 'Tomatoes, beans, squash. A future.')
quest('toolbox', "Mechanic's toolbox", 5, 'Heavy. Everything a generator needs.')
quest('map_piece', 'Ranger map', 0.05, 'Marked with circles in red pen.')

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)
/** Every item, in a fixed order: an item's index is its id on the wire. */
export const ITEM_LIST: readonly ItemDef[] = defs
const INDEX = new Map(defs.map((d, i) => [d.id, i]))

export function itemIndex(id: string): number {
  return INDEX.get(id) ?? 0
}

export function itemOf(id: string): ItemDef | undefined {
  return ITEMS[id]
}

const BY_WEAPON = new Map(defs.filter((d) => d.weapon !== undefined).map((d) => [d.weapon, d.id]))
const BY_AMMO = new Map(defs.filter((d) => d.ammo !== undefined).map((d) => [d.ammo, d.id]))

/** The item a weapon is when it's in a backpack or on the floor. */
export function weaponItem(weapon: WeaponId): string {
  return BY_WEAPON.get(weapon) ?? 'knife'
}

/** The item a kind of ammunition is. */
export function ammoItem(type: AmmoType): string {
  return BY_AMMO.get(type) ?? 'ammo9'
}

// --- Loot ---------------------------------------------------------------------------------

/** What kind of place a loot spot is: decides what may lie there. */
export const LOOT_TABLES = [
  'kitchen',
  'medical',
  'garage',
  'bedroom',
  'store',
  'gun',
  'police',
  'military',
  'hunting',
  'camp',
  'cache',
  'pack',
  'melee',
  'office',
  /** Pumps, sheds and generators: where a jerry can is most likely to be. */
  'fuel',
] as const
export type LootTable = (typeof LOOT_TABLES)[number]

/** One thing a spot may hold: item, how likely (relative), and how many (min–max). */
type Entry = [item: string, weight: number, min?: number, max?: number]

interface TableDef {
  /** Chance the spot is empty. */
  empty: number
  entries: Entry[]
}

const TABLES: Record<LootTable, TableDef> = {
  kitchen: {
    empty: 0.3,
    entries: [
      ['beans', 10],
      ['soup', 9],
      ['tuna', 8],
      ['peaches', 5],
      ['chips', 7],
      ['cereal', 6],
      ['apple', 4],
      ['dogfood', 4],
      ['water', 9],
      ['soda', 7],
      ['juice', 4],
      ['beer', 4],
      ['coffee', 2],
      ['dirtywater', 4],
      ['knife', 3],
      ['lighter', 2],
      ['whiskey', 1],
    ],
  },
  medical: {
    empty: 0.25,
    entries: [
      ['bandage', 12, 1, 2],
      ['rags', 8, 1, 3],
      ['painkillers', 8],
      ['medkit', 3],
      ['antibiotics', 2],
      ['adrenaline', 1.5],
      ['water', 2],
    ],
  },
  garage: {
    empty: 0.3,
    entries: [
      ['scrap', 10, 1, 3],
      ['ducttape', 7],
      ['toolkit', 4],
      ['electronics', 5],
      ['batteries', 6],
      ['gasoline', 2],
      ['crowbar', 3],
      ['bat', 2],
      ['axe', 1.5],
      ['sledge', 1],
      ['lighter', 2],
    ],
  },
  bedroom: {
    empty: 0.4,
    entries: [
      ['cash', 9, 5, 40],
      ['watch', 3],
      ['ring', 1.5],
      ['necklace', 1.5],
      ['cigarettes', 5],
      ['batteries', 4],
      ['painkillers', 3],
      ['chocolate', 4],
      ['ammo9', 3, 4, 10],
      ['ammo22', 3, 8, 20],
      ['pack_school', 1.5],
      ['bat', 1.5],
      ['glock', 0.6],
      ['revolver', 0.4],
    ],
  },
  store: {
    empty: 0.3,
    entries: [
      ['chips', 9],
      ['chocolate', 8],
      ['energybar', 8],
      ['jerky', 6],
      ['soda', 9],
      ['water', 8],
      ['energydrink', 5],
      ['juice', 4],
      ['cigarettes', 6],
      ['lighter', 4],
      ['batteries', 7],
      ['beer', 5],
      ['cash', 4, 3, 25],
      ['ducttape', 2],
    ],
  },
  gun: {
    empty: 0.25,
    entries: [
      ['ammo9', 10, 6, 18],
      ['ammo45', 7, 5, 12],
      ['ammo12', 7, 3, 8],
      ['ammo22', 7, 10, 30],
      ['ammo357', 4, 4, 8],
      ['ammo308', 3, 3, 6],
      ['ammo762', 3, 6, 15],
      ['m9', 1.5],
      ['m1911', 1.5],
      ['ruger', 1],
      ['carbine22', 1.2],
      ['doublebarrel', 1.2],
      ['lever', 0.8],
      ['pump', 0.8],
      ['sawedoff', 0.7],
      ['revolver', 0.8],
      ['uzi', 0.6],
      ['mac10', 0.6],
    ],
  },
  police: {
    empty: 0.2,
    entries: [
      ['ammo9', 10, 10, 24],
      ['ammo45', 5, 6, 14],
      ['ammo12', 7, 4, 10],
      ['ammo556', 3, 10, 20],
      ['m9', 3],
      ['glock', 3],
      ['pump', 2],
      ['mp5', 1],
      ['m4', 0.5],
      ['bandage', 3],
      ['medkit', 1],
      ['batteries', 3],
    ],
  },
  military: {
    empty: 0.2,
    entries: [
      ['ammo556', 10, 12, 30],
      ['ammo762', 6, 10, 25],
      ['ammo9', 5, 10, 20],
      ['ammo308', 3, 4, 8],
      ['ammo50', 0.7, 2, 4],
      ['mre', 6],
      ['medkit', 3],
      ['bandage', 4, 1, 2],
      ['adrenaline', 1.5],
      ['m4', 1.2],
      ['ak47', 1],
      ['ump', 0.9],
      ['mp5', 0.9],
      ['saiga', 0.4],
      ['svd', 0.3],
      ['m249', 0.25],
      ['uzi', 0.5],
      ['barrett', 0.08],
      ['pack_military', 0.5],
      ['machete', 1],
      ['batteries', 3],
    ],
  },
  hunting: {
    empty: 0.25,
    entries: [
      ['ammo308', 8, 3, 8],
      ['ammo357', 5, 4, 8],
      ['ammo12', 6, 3, 8],
      ['ammo22', 6, 10, 24],
      ['bolts', 5, 2, 5],
      ['hunting', 1.5],
      ['lever', 1.2],
      ['crossbow', 1.2],
      ['carbine22', 1.2],
      ['doublebarrel', 1.2],
      ['jerky', 5],
      ['machete', 1.5],
      ['axe', 1.5],
      ['pack_hiking', 0.7],
      ['coffee', 2],
    ],
  },
  camp: {
    empty: 0.35,
    entries: [
      ['beans', 7],
      ['jerky', 5],
      ['water', 7],
      ['energybar', 5],
      ['bandage', 4],
      ['lighter', 4],
      ['batteries', 4],
      ['berries', 4],
      ['coffee', 3],
      ['machete', 1],
      ['axe', 1.5],
      ['pack_hiking', 0.8],
      ['pack_school', 1],
      ['bolts', 2, 1, 3],
      ['ammo22', 3, 6, 16],
      ['dirtywater', 3],
    ],
  },
  cache: {
    empty: 0,
    entries: [
      ['medkit', 5],
      ['ammo556', 5, 20, 40],
      ['ammo762', 5, 20, 40],
      ['ammo308', 4, 6, 12],
      ['ammo12', 4, 8, 16],
      ['ammo50', 1, 3, 5],
      ['cash', 5, 60, 200],
      ['mre', 4, 1, 2],
      ['ak47', 1.5],
      ['sks', 1.5],
      ['sniper', 0.7],
      ['saiga', 0.6],
      ['barrett', 0.3],
      ['mac10', 0.5],
      ['katana', 0.4],
      ['pack_military', 0.8],
      ['adrenaline', 2],
      ['whiskey', 2],
      ['ring', 2],
    ],
  },
  pack: {
    empty: 0.35,
    entries: [
      ['pack_school', 6],
      ['pack_hiking', 3],
      ['pack_military', 0.7],
    ],
  },
  melee: {
    empty: 0.3,
    entries: [
      ['bat', 6],
      ['crowbar', 6],
      ['machete', 3],
      ['axe', 3],
      ['sledge', 2],
      ['knife', 4],
      ['katana', 0.2],
    ],
  },
  office: {
    empty: 0.45,
    entries: [
      ['cash', 6, 2, 30],
      ['electronics', 5],
      ['batteries', 5],
      ['cigarettes', 3],
      ['coffee', 3],
      ['painkillers', 2],
      ['watch', 1.5],
      ['energybar', 3],
      ['ducttape', 2],
    ],
  },
  fuel: {
    empty: 0.25,
    entries: [
      ['gasoline', 10],
      ['scrap', 3, 1, 2],
      ['lighter', 2],
      ['ducttape', 1.5],
      ['batteries', 1.5],
    ],
  },
}

/** Rolls what lies at a spot of this kind: an item and how many, or null for nothing. */
export function rollLoot(
  table: LootTable,
  random: () => number,
): { item: string; n: number } | null {
  const def = TABLES[table]
  if (random() < def.empty) return null
  const total = def.entries.reduce((sum, e) => sum + e[1], 0)
  let pick = random() * total
  for (const [item, weight, min = 1, max = min] of def.entries) {
    pick -= weight
    if (pick <= 0) return { item, n: min + Math.floor(random() * (max - min + 1)) }
  }
  return null
}

/** Every item a table can produce (for tests: they must all exist). */
export function tableItems(table: LootTable): string[] {
  return TABLES[table].entries.map((e) => e[0])
}

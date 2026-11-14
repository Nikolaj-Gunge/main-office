import type { LootTable } from './items.ts'
import { Site, type WorldBuild } from './kit.ts'
import { note } from './places-kit.ts'
import { FLOOR } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * The quests' own things, added after every place is built: Hollis' footlocker at Haven, and a
 * few things lying where the side jobs send you. Each sits on a surface a loot spot already
 * uses (a counter, a shelf, a desk), so it lands on something solid whatever the building.
 */
export function placeLore(build: WorldBuild, pois: readonly Poi[]): void {
  const site = (key: string): Site | null => {
    const i = pois.findIndex((p) => p.key === key)
    const poi = pois[i]
    return poi ? new Site(build, poi, i, 0, 0, 0) : null
  }
  /** The loot spot of `table` at place `key` nearest to (dx, dz) from its middle, as local x/y/z. */
  const spotNear = (key: string, table: LootTable, dx: number, dz: number) => {
    const i = pois.findIndex((p) => p.key === key)
    const poi = pois[i]
    if (!poi) return null
    let best: [number, number, number] | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const l of build.loot) {
      if (l.poi !== i || l.table !== table) continue
      const x = l.pos[0] - poi.x
      const z = l.pos[2] - poi.z
      const d = Math.hypot(x - dx, z - dz)
      if (d < bestD) {
        bestD = d
        best = [x, l.pos[1] - poi.y, z]
      }
    }
    return best
  }
  /** Something to search, a small box on the surface by a loot spot. */
  const thing = (
    key: string,
    at: [number, number, number] | null,
    s: Site | null,
    label: string,
  ) => {
    if (!at || !s) return
    const [x, y, z] = at
    s.deco(x + 0.25, y, z, 0.34, 0.18, 0.24, 'metal')
    s.interact(key, 'search', x + 0.25, y + 0.15, z, label)
  }

  // Hollis' footlocker, at the foot of the empty bunk in Haven's bunkhouse.
  const haven = site('haven')
  if (haven) {
    haven.block(-12.6, FLOOR, 14.3, 0.9, 0.45, 0.5, 'wood')
    haven.deco(-12.6, FLOOR + 0.45, 14.3, 0.92, 0.04, 0.52, 'metal')
    note(haven, 'hollis_locker', -12.6, FLOOR + 0.5, 14.3, '')
  }

  // Dot's recipe tin, in the kitchen of her diner in Mill Creek.
  thing(
    'dot_recipes',
    spotNear('millcreek', 'kitchen', 14, -41),
    site('millcreek'),
    'Take the recipe tin',
  )
  // Gus' cash box, under the counter of the gun shop he fenced through.
  thing(
    'gus_cashbox',
    spotNear('millcreek', 'gun', -14, -45),
    site('millcreek'),
    'Take the cash box',
  )
  // What Sam's mum left at the Pinewatch clinic.
  const pinewatch = site('pinewatch')
  const desk = spotNear('pinewatch', 'medical', -22, -15.5)
  if (pinewatch && desk) note(pinewatch, 'sam_mum_note', desk[0] - 0.3, desk[1], desk[2], '')
  // The medical bay of Bunker 4, where the army kept its penicillin.
  thing(
    'bunker4_medbay',
    spotNear('bunker_south', 'medical', 0, 0),
    site('bunker_south'),
    'Search the medical crate',
  )
}

import { buildDeadwood } from '../survival/world.ts'
import { buildCampus } from './campus.ts'
import { buildCornfield } from './cornfield.ts'
import { buildGym } from './gym.ts'
import { buildMall } from './mall.ts'
import { buildMeetingRoom } from './meeting-room.ts'
import { buildMetro } from './metro.ts'
import { buildOffice } from './office.ts'
import { buildOutbreak } from './outbreak.ts'
import { buildRange } from './range.ts'
import { buildRooftop } from './rooftop.ts'
import type { MapDef } from './types.ts'
import { buildWarehouse } from './warehouse.ts'

export * from './builder.ts'
export * from './range.ts'
export * from './spawn-points.ts'
export * from './types.ts'

/** Every map but survival's: small enough to ship in the client's main bundle. */
const ARENA_MAPS: Record<string, () => MapDef> = {
  gym: buildGym,
  range: buildRange,
  office: buildOffice,
  // Small
  meetingroom: buildMeetingRoom,
  rooftop: buildRooftop,
  // Large
  warehouse: buildWarehouse,
  campus: buildCampus,
  // Co-op (zombies mode)
  outbreak: buildOutbreak,
  mall: buildMall,
  metro: buildMetro,
  cornfield: buildCornfield,
}

export const DEFAULT_MAP_ID = 'office'

/** Maps built for co-op (zombies mode needs one; they stay out of the map rotation). */
export const COOP_MAPS = ['outbreak', 'mall', 'metro', 'cornfield'] as const

/** The survival mode's map (the two always go together). */
export const SURVIVAL_MAP = 'deadwood'

/**
 * Every map, built synchronously (the server and the Cloudflare worker). The client uses
 * `MAP_IDS` and `loadMapAsync` instead, which keep survival's ~100 kB world builder out of its
 * main bundle.
 */
export const MAPS: Record<string, () => MapDef> = {
  ...ARENA_MAPS,
  // Survival: one open world
  [SURVIVAL_MAP]: buildDeadwood,
}

/** Every map id, in menu order (needs none of the builders). */
export const MAP_IDS: readonly string[] = [...Object.keys(ARENA_MAPS), SURVIVAL_MAP]

export function loadMap(id: string): MapDef {
  const build = MAPS[id]
  if (!build) throw new Error(`Unknown map "${id}"`)
  return build()
}

/** Like `loadMap`, but survival's world builder is only fetched when that map is asked for. */
export async function loadMapAsync(id: string): Promise<MapDef> {
  if (id === SURVIVAL_MAP) return (await import('../survival/world.ts')).buildDeadwood()
  const build = ARENA_MAPS[id]
  if (!build) throw new Error(`Unknown map "${id}"`)
  return build()
}

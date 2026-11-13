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
import { buildDeadwood } from '../survival/world.ts'

export * from './builder.ts'
export * from './range.ts'
export * from './spawn-points.ts'
export * from './types.ts'

export const MAPS: Record<string, () => MapDef> = {
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
  // Survival: one open world
  deadwood: buildDeadwood,
}

export const DEFAULT_MAP_ID = 'office'

/** Maps built for co-op (zombies mode needs one; they stay out of the map rotation). */
export const COOP_MAPS = ['outbreak', 'mall', 'metro', 'cornfield'] as const

/** The survival mode's map (the two always go together). */
export const SURVIVAL_MAP = 'deadwood'

export function loadMap(id: string): MapDef {
  const build = MAPS[id]
  if (!build) throw new Error(`Unknown map "${id}"`)
  return build()
}

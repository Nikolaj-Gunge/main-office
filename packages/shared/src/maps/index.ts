import { buildGym } from './gym.ts'
import { buildMeetingRoom } from './meeting-room.ts'
import { buildOffice } from './office.ts'
import { buildRooftop } from './rooftop.ts'
import type { MapDef } from './types.ts'

export * from './builder.ts'
export * from './spawn-points.ts'
export * from './types.ts'

export const MAPS: Record<string, () => MapDef> = {
  gym: buildGym,
  office: buildOffice,
  meetingroom: buildMeetingRoom,
  rooftop: buildRooftop,
}

export const DEFAULT_MAP_ID = 'office'

export function loadMap(id: string): MapDef {
  const build = MAPS[id]
  if (!build) throw new Error(`Unknown map "${id}"`)
  return build()
}

import type { Site } from './kit.ts'
import { campfire, crate } from './structures.ts'
import type { Poi, PoiKind } from './types.ts'

/** Builds one place on its site. `variant` counts places of the same kind (0, 1, 2…). */
export type PlaceBuilder = (s: Site, poi: Poi, variant: number) => void

/** Placeholder until the place is built properly: a fire and a crate. */
const stub: PlaceBuilder = (s) => {
  campfire(s, 0, 0, false)
  crate(s, 2, 1, 0.8, 'camp')
  s.zombie(4, 4)
}

/** Every kind of place except the start, cabins and the camp (see structures.ts). */
export const PLACES: Record<Exclude<PoiKind, 'start' | 'cabin' | 'camp'>, PlaceBuilder> = {
  town: stub,
  gas: stub,
  bunker: stub,
  tower: stub,
  ranger: stub,
  checkpoint: stub,
  crash: stub,
  campsite: stub,
  farm: stub,
  sawmill: stub,
  church: stub,
  lake: stub,
  motel: stub,
  trailers: stub,
  quarry: stub,
  radio: stub,
  cache: stub,
}

import type { PlaceWorld, Site } from './kit.ts'
import { camper, house, shed } from './places-homes.ts'
import { bunker, checkpoint, crash, radio } from './places-military.ts'
import { farm, gas, motel, quarry, sawmill, trailers } from './places-roadside.ts'
import { town } from './places-town.ts'
import { stand, treehouse } from './places-trees.ts'
import { cache, campsite, church, lake, ranger, tower } from './places-wild.ts'
import type { Poi, PoiKind } from './types.ts'

export type { PlaceWorld } from './kit.ts'

/** Builds one place on its site. `variant` counts places of the same kind (0, 1, 2…). */
export type PlaceBuilder = (s: Site, poi: Poi, variant: number, world: PlaceWorld) => void

/** Every kind of place except the start, cabins and the camp (see structures.ts). */
export const PLACES: Record<Exclude<PoiKind, 'start' | 'cabin' | 'camp'>, PlaceBuilder> = {
  town: (s, poi) => town(s, poi),
  gas: (s, poi) => gas(s, poi),
  bunker,
  tower,
  ranger,
  checkpoint,
  crash: (s) => crash(s),
  campsite,
  farm: (s) => farm(s),
  sawmill: (s) => sawmill(s),
  church,
  lake,
  motel: (s) => motel(s),
  trailers: (s) => trailers(s),
  quarry: (s) => quarry(s),
  radio: (s) => radio(s),
  cache,
  house,
  camper,
  shed,
  treehouse,
  stand,
}

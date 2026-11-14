import type { MapDef, MapLighting } from '../maps/types.ts'
import { emptyBuild, Site } from './kit.ts'
import { PLACES } from './places.ts'
import { havenLife } from './places-haven.ts'
import { camperName, houseName, shedName } from './places-homes.ts'
import { dressRoads } from './road-dressing.ts'
import { type ScatterKind, scatterPlaces } from './scatter.ts'
import { cabin, haven, startCabin } from './structures.ts'
import { buildTerrain, heightAt, type RoadPlan } from './terrain.ts'
import type { Poi, PoiKind, SurvivalDef } from './types.ts'

export const DEADWOOD_ID = 'deadwood'
const SEED = 1987

interface Plan {
  key: string
  kind: PoiKind
  name: string
  x: number
  z: number
  r: number
  danger: number
  lift?: number
  skirt?: number
  /** Quarter turns clockwise. */
  turn?: number
  safe?: boolean
  hidden?: boolean
  wooded?: boolean
}

const place = (
  key: string,
  kind: PoiKind,
  name: string,
  x: number,
  z: number,
  r: number,
  danger: number,
  extra: Partial<Plan> = {},
): Plan => ({ key, kind, name, x, z, r, danger, ...extra })

/** The cabins scattered through the woods (x, z). */
const CABINS: [number, number][] = [
  [-300, -900],
  [-560, -620],
  [-1250, -950],
  [700, -1250],
  [-80, -1180],
  [1340, -800],
  [620, -480],
  [-1300, -150],
  [-1050, 150],
  [-250, -130],
  [560, 380],
  [1340, 60],
  [-900, 620],
  [-350, 1250],
  [560, 1280],
  [1300, 820],
  [-1320, 900],
  [-640, 420],
  [860, 1300],
  [-700, -1250],
]
const CAMPSITES: [number, number][] = [
  [-620, -1000],
  [560, -700],
  [-1050, -420],
  [1000, -540],
  [-180, 130],
  [760, 470],
  [-820, 300],
  [420, 1150],
  [1080, 1320],
  [-420, 480],
]
const CACHES: [number, number][] = [
  [-1330, 1300],
  [1340, -1330],
  [-100, -1340],
  [640, 1040],
  [-1100, -900],
  [1340, 300],
]

/**
 * Deadwood: three kilometres of dark forest. x runs east, z runs south. The survivor camp
 * (Haven) sits south of the middle, three towns in the north-west, east and north, and the
 * places the story sends you to are spread to the corners.
 */
const PLANS: Plan[] = [
  place('start', 'start', "Hollis' cabin", -140, 930, 13, 0, { wooded: true, turn: 0 }),
  place('haven', 'camp', 'Haven', 0, 480, 44, 0, { safe: true }),
  // Towns: the more people lived somewhere, the more of them are still there.
  place('pinewatch', 'town', 'Pinewatch', -820, -260, 95, 12),
  place('millcreek', 'town', 'Mill Creek', 960, 240, 90, 12),
  place('ashford', 'town', 'Ashford', 340, -1010, 110, 16),
  place('gas_north', 'gas', 'Gas-N-Go', 10, -640, 30, 4),
  place('gas_south', 'gas', 'Last Stop Fuel', 310, 960, 30, 4),
  place('site7', 'bunker', 'Site 7', 1150, -1130, 36, 9, { lift: 20, skirt: 75 }),
  place('bunker_west', 'bunker', 'Bunker 12', -1210, 440, 26, 4, { lift: 15, skirt: 60, turn: 2 }),
  place('bunker_south', 'bunker', 'Bunker 4', 90, 1270, 26, 4, { lift: 13, skirt: 55, turn: 3 }),
  place('radio', 'radio', 'Radio tower', -960, -1140, 28, 5, { lift: 24, skirt: 85 }),
  place('ranger_nw', 'ranger', 'Ranger station', -1160, -640, 22, 2),
  place('ranger_se', 'ranger', 'Ranger station', 1240, 1190, 22, 2, { turn: 2 }),
  place('ranger_e', 'ranger', 'Ranger station', 1320, -430, 22, 2, { lift: 8, skirt: 40, turn: 1 }),
  place('checkpoint_east', 'checkpoint', 'Army checkpoint', 780, -740, 34, 9),
  place('checkpoint_south', 'checkpoint', 'Roadblock', 1000, 890, 30, 6),
  place('crash', 'crash', 'Crash site', -1010, 1090, 30, 6),
  place('farm', 'farm', 'Abernathy farm', -450, 160, 60, 6),
  place('sawmill', 'sawmill', 'Mill Creek sawmill', 1250, 560, 50, 8),
  place('church', 'church', "St. Agnes' church", 250, -350, 40, 7),
  place('lake', 'lake', "Miller's Lake", 280, 110, 20, 2),
  place('motel', 'motel', 'Pine Rest motel', 600, 660, 50, 8),
  place('trailers', 'trailers', 'Shady Acres', -600, 800, 50, 7),
  place('quarry', 'quarry', 'Quarry', 1160, -300, 55, 3, { lift: -7, skirt: 30 }),
  place('tower_1', 'tower', 'Fire lookout', 540, -150, 14, 1, { lift: 9, skirt: 45 }),
  place('tower_2', 'tower', 'Fire lookout', -760, 1320, 14, 1, { lift: 7, skirt: 40 }),
  place('tower_3', 'tower', 'Fire lookout', -1340, -420, 14, 1, { lift: 10, skirt: 45 }),
  ...CABINS.map(([x, z], i) =>
    place(`cabin_${i + 1}`, 'cabin', 'Cabin', x, z, 13, 1 + (i % 2), { wooded: true, turn: i % 4 }),
  ),
  ...CAMPSITES.map(([x, z], i) =>
    place(`campsite_${i + 1}`, 'campsite', 'Campsite', x, z, 11, i % 3, {
      wooded: true,
      turn: i % 4,
    }),
  ),
  ...CACHES.map(([x, z], i) =>
    place(`cache_${i + 1}`, 'cache', 'Stash', x, z, 7, 0, { wooded: true, hidden: true }),
  ),
]

const asphalt = (...points: [number, number][]): RoadPlan => ({ kind: 'asphalt', width: 7, points })
const dirt = (...points: [number, number][]): RoadPlan => ({ kind: 'dirt', width: 4, points })

const ROADS: RoadPlan[] = [
  // The highway, north to south, passing east of Haven.
  asphalt(
    [340, -1010],
    [200, -830],
    [10, -640],
    [150, -420],
    [170, -150],
    [200, 100],
    [120, 300],
    [90, 390],
    [130, 600],
    [310, 960],
    [330, 1250],
    [330, 1500],
  ),
  // West to east: Pinewatch – the church – Mill Creek.
  asphalt(
    [-820, -260],
    [-500, -300],
    [-150, -380],
    [150, -420],
    [250, -350],
    [520, -200],
    [760, 0],
    [960, 240],
  ),
  // Haven's gate, and the road east past the motel.
  asphalt([90, 390], [0, 425], [0, 448]),
  asphalt([90, 390], [350, 520], [600, 660], [820, 480], [960, 240]),
  // Ashford – the army checkpoint; a dirt track on to Site 7.
  asphalt([340, -1010], [600, -860], [780, -740]),
  dirt([780, -740], [960, -940], [1150, -1130]),
  // South: the roadblock on the way out of the county.
  asphalt([310, 960], [650, 930], [1000, 890], [1500, 880]),
  dirt([-820, -260], [-900, -700], [-960, -1140]),
  dirt([-500, -300], [-470, -60], [-450, 160]),
  dirt([960, 240], [1120, 400], [1250, 560]),
  dirt([130, 600], [-200, 700], [-600, 800], [-820, 950], [-1010, 1090]),
  dirt([-140, 930], [-170, 780], [-200, 700]),
  dirt([760, 0], [1000, -200], [1160, -300]),
  dirt([-820, -260], [-1050, 100], [-1210, 440]),
]

const LAKES = [{ x: 420, z: 110, r: 85 }]

const SCATTER_NAMES: Record<ScatterKind, (variant: number) => string> = {
  house: houseName,
  camper: camperName,
  shed: shedName,
  treehouse: () => 'Treehouse',
  stand: () => 'Hunting stand',
}
const SCATTER_DANGER: Record<ScatterKind, number> = {
  house: 2,
  camper: 1,
  shed: 1,
  treehouse: 1,
  stand: 0,
}

/** Every place: the planned ones, then the small ones scattered between them (see scatter.ts). */
const ALL_PLANS: Plan[] = (() => {
  const counts = new Map<ScatterKind, number>()
  const scattered = scatterPlaces(SEED, PLANS, ROADS, LAKES).map((p) => {
    const variant = counts.get(p.kind) ?? 0
    counts.set(p.kind, variant + 1)
    return place(
      `${p.kind}_${variant + 1}`,
      p.kind,
      SCATTER_NAMES[p.kind](variant),
      p.x,
      p.z,
      p.r,
      SCATTER_DANGER[p.kind] + (p.kind === 'house' ? variant % 2 : 0),
      { turn: p.turn, wooded: p.wooded, hidden: true },
    )
  })
  return [...PLANS, ...scattered]
})()

/**
 * Night under a thin moon: enough to make out the trees around you and the shape of the ground,
 * never enough to see what is standing between them. (The client uses these as they are, without
 * the darkening it gives other night maps.)
 */
const LIGHTING: MapLighting = {
  sunDirection: [0.35, 0.8, 0.3],
  sunColor: 0x9db4ff,
  sunIntensity: 0.95,
  skyColor: 0x2c3c60,
  groundColor: 0x11150d,
  ambientIntensity: 1.25,
  fogColor: 0x0c121c,
  fogNear: 6,
  fogFar: 78,
}

let cached: MapDef | null = null

/** The survival map: the whole world, built once per process (it's the same every time). */
export function buildDeadwood(): MapDef {
  if (cached) return cached
  const { terrain, heights, roads, lakes } = buildTerrain(SEED, ALL_PLANS, ROADS, LAKES)
  const pois: Poi[] = ALL_PLANS.map((p, i) => ({
    key: p.key,
    kind: p.kind,
    name: p.name,
    x: p.x,
    z: p.z,
    y: heights[i] as number,
    r: p.r,
    danger: p.danger,
    ...(p.safe ? { safe: true } : {}),
    ...(p.hidden ? { hidden: true } : {}),
  }))

  const build = emptyBuild()
  const world = { groundAt: (x: number, z: number) => heightAt(terrain, x, z), lakes }
  const counts = new Map<PoiKind, number>()
  pois.forEach((poi, i) => {
    const variant = counts.get(poi.kind) ?? 0
    counts.set(poi.kind, variant + 1)
    const site = new Site(build, poi, i, 0, 0, ALL_PLANS[i]?.turn ?? 0)
    if (poi.kind === 'start') startCabin(site)
    else if (poi.kind === 'cabin') cabin(site, variant)
    else if (poi.kind === 'camp') {
      haven(site)
      havenLife(site)
    } else PLACES[poi.kind](site, poi, variant, world)
  })
  // Along the roads: streetlamps, power lines, signs (after the places, to keep out of them).
  const signs = dressRoads(build, { roads, pois, lakes, groundAt: world.groundAt }, SEED)

  const survival: SurvivalDef = {
    seed: SEED,
    terrain,
    pois,
    roads,
    lakes,
    loot: build.loot,
    zombieSpots: build.zombieSpots,
    npcs: build.npcs,
    interactables: build.interactables,
    rooms: build.rooms,
    spots: build.spots,
    starter: build.starter,
    signs,
  }
  const start = pois[0] as Poi
  cached = {
    id: DEADWOOD_ID,
    name: 'Deadwood (survival)',
    boxes: build.boxes,
    spawns: [{ pos: [start.x - 2.3, start.y + 0.14, start.z + 0.4], yaw: 0 }],
    labels: build.labels,
    lighting: LIGHTING,
    lights: build.lights,
    survival,
  }
  return cached
}

/** How many quarter turns a place is built turned by (tests: to find their way round it). */
export function placeTurn(key: string): number {
  return ALL_PLANS.find((p) => p.key === key)?.turn ?? 0
}

/** A place by its key. */
export function poiByKey(def: SurvivalDef, key: string): Poi | undefined {
  return def.pois.find((p) => p.key === key)
}

/** The place a point is at: inside its clearing (plus `margin`), nearest first; or null. */
export function poiAt(def: SurvivalDef, x: number, z: number, margin = 0): number | null {
  let best: number | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (let i = 0; i < def.pois.length; i++) {
    const p = def.pois[i] as Poi
    const d = Math.hypot(p.x - x, p.z - z)
    if (d <= p.r + margin && d < bestD) {
      best = i
      bestD = d
    }
  }
  return best
}

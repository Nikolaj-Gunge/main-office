import type { Vec3 } from '../maps/types.ts'
import type { LootTable } from './items.ts'
import type { RoadSign } from './road-dressing.ts'

/** The survival world is this many metres across (square, centred on the origin). */
export const WORLD_SIZE = 3072
export const WORLD_HALF = WORLD_SIZE / 2
/** Terrain grid: one height every CELL metres. */
export const CELL = 4
export const GRID = WORLD_SIZE / CELL
/** The forest is built (and its trees made solid) one chunk at a time, around the players. */
export const CHUNK = 64
export const CHUNKS = WORLD_SIZE / CHUNK

/** What the ground is at a spot (the client colours it). */
export const Surface = { Forest: 0, Meadow: 1, Dirt: 2, Sand: 3, Rock: 4 } as const

export interface Terrain {
  /** (GRID + 1)² heights, index = xi * (GRID + 1) + zi. */
  heights: Float32Array
  /** Per vertex: how thick the forest is, 0 (open) – 255. */
  cover: Uint8Array
  /** Per vertex: a Surface. */
  surface: Uint8Array
}

export type PoiKind =
  | 'start'
  | 'camp'
  | 'town'
  | 'gas'
  | 'bunker'
  | 'cabin'
  | 'tower'
  | 'ranger'
  | 'checkpoint'
  | 'crash'
  | 'campsite'
  | 'farm'
  | 'sawmill'
  | 'church'
  | 'lake'
  | 'motel'
  | 'trailers'
  | 'quarry'
  | 'radio'
  | 'cache'

/** A place in the world: a clearing of flat ground with something built on it. */
export interface Poi {
  key: string
  kind: PoiKind
  name: string
  x: number
  z: number
  /** Ground height of its flat part. */
  y: number
  /** Radius of the flat, tree-less ground (m). */
  r: number
  /** How many of the dead live here (0 = none). */
  danger: number
  /** The dead never come here (the survivor camp). */
  safe?: boolean
  /** Not on the map until someone has been there. */
  hidden?: boolean
}

export interface Road {
  kind: 'asphalt' | 'dirt'
  /** Metres wide. */
  width: number
  /** Centre line every couple of metres, on the ground. */
  line: { x: number; y: number; z: number }[]
}

export interface Lake {
  x: number
  z: number
  r: number
  /** Height of the water surface. */
  y: number
}

/** A spot where something to take may lie (rolled by the server when someone first comes near). */
export interface LootSpot {
  pos: Vec3
  table: LootTable
  /** Index of the Poi it belongs to. */
  poi: number
}

export type NpcRole =
  | 'leader'
  | 'trader'
  | 'medic'
  | 'mechanic'
  | 'hunter'
  | 'cook'
  | 'kid'
  | 'guard'
  | 'radio'
  | 'priest'

/** Someone to talk to (they never move, and nothing hurts them). */
export interface Npc {
  key: string
  name: string
  role: NpcRole
  pos: Vec3
  yaw: number
  /** Shirt colour index (PLAYER_COLORS). */
  color: number
}

/** `search`: a locker, desk or body with one particular thing in it (quests). */
export type InteractKind =
  | 'bed'
  | 'radio'
  | 'generator'
  | 'terminal'
  | 'lever'
  | 'water'
  | 'flare'
  | 'search'
  | 'note'

/** Something in the world you can use with E. */
export interface Interactable {
  key: string
  kind: InteractKind
  pos: Vec3
  /** What the prompt says, e.g. "Sleep". */
  label: string
  poi: number
  /** Notes: what it says when read. */
  text?: string
}

/**
 * The inside of a building (x/z box, world space) and where its doors are, so the dead can find
 * their way in after you instead of scratching at the wall.
 */
export interface Room {
  min: [number, number]
  max: [number, number]
  doors: Vec3[]
}

/** Everything about the survival world that isn't boxes: built once, same on client and server. */
/**
 * A doorway or open window in a building's outer wall that can be boarded up (see
 * barricades.ts): the bottom middle of the gap, how wide and high it is, and which way the wall
 * runs.
 */
export interface BoardSpot {
  x: number
  y: number
  z: number
  w: number
  h: number
  /** The wall runs along world x (so the gap is crossed along z). */
  alongX: boolean
  door: boolean
  poi: number
}

export interface SurvivalDef {
  seed: number
  terrain: Terrain
  pois: Poi[]
  roads: Road[]
  lakes: Lake[]
  loot: LootSpot[]
  /** Where the dead of a place stand around (feet). */
  zombieSpots: { pos: Vec3; poi: number }[]
  npcs: Npc[]
  interactables: Interactable[]
  rooms: Room[]
  /** Doorways and windows people can board up. */
  spots: BoardSpot[]
  /** Road sign faces (their posts are map boxes); see road-dressing.ts. */
  signs?: RoadSign[]
}

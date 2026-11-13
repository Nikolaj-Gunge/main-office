import type { SurvivalDef } from '../survival/types.ts'

export type Vec3 = readonly [number, number, number]

/** Surface materials. The client maps each to a texture; later the server maps them to impact/penetration rules. */
export const MATERIALS = [
  // Gym / dev textures
  'floor',
  'wall',
  'cover',
  'platform',
  'marker',
  'target',
  'ramp',
  // Office
  'carpet',
  'wood',
  'tile',
  'concrete',
  'plaster',
  'ceiling',
  'glass',
  'desk',
  'metal',
  'fabric',
  'fabricAlt',
  'screen',
  'plant',
  'accent',
  'lightpanel',
  'rack',
  'whiteboard',
  // Farm (cornfield)
  'dirt',
  'grass',
  'corn',
  'hay',
  'barn',
  // Survival (Deadwood)
  'asphalt',
  'log',
  'shingle',
  'brick',
  'rust',
  'canvas',
  'sandbag',
  /** A red lamp that glows by itself: beacons, emergency lights. */
  'warnlight',
] as const
export type MaterialId = (typeof MATERIALS)[number]

/** Axis-aligned box, optionally rotated about its center (Euler XYZ, radians). Units are meters. */
export interface MapBox {
  center: Vec3
  size: Vec3
  rotation?: Vec3
  material: MaterialId
  /** Default true. False = decoration you can walk/shoot through (chair backs, monitors, cables). */
  collide?: boolean
  /** Default true. False = invisible collider (e.g. one solid block around a detailed desk). */
  render?: boolean
  /**
   * Part of a gate (co-op maps): solid and drawn while the gate is shut, gone once it opens.
   * Gates open as the team completes stages (CoopStage.opens).
   */
  gate?: number
}

/** A light placed in the map (client only). */
export interface MapLight {
  kind: 'point' | 'spot'
  pos: Vec3
  color: number
  intensity: number
  /** Range in metres. */
  distance: number
  /** Spot lights point straight down from `pos`. */
  angleDeg?: number
  /** 0–1: how badly it flickers (a failing tube, a loose wire). Absent = steady. */
  flicker?: number
}

export interface MapSpawn {
  /** Feet position. */
  pos: Vec3
  /** Radians. 0 looks down -Z, positive turns left (counter-clockwise seen from above). */
  yaw: number
}

/** World-space text, for gym measurements and debug callouts. Client-only. */
export interface MapLabel {
  pos: Vec3
  text: string
}

export interface MapLighting {
  /** Direction the sunlight travels *from* (points at the sun). Need not be normalized. */
  sunDirection: Vec3
  sunColor: number
  sunIntensity: number
  skyColor: number
  groundColor: number
  ambientIntensity: number
  fogColor: number
  fogNear: number
  fogFar: number
}

/** A spot where a weapon lies on the floor and comes back after being taken. */
export interface MapPickup {
  /** Where it lies (bottom of the weapon). */
  pos: Vec3
  /** WeaponId (rifle 1 / sniper 2). */
  weapon: number
  /** Seconds before a taken weapon reappears. */
  respawn: number
}

export interface MapDef {
  /** Survival mode: the open world this map's boxes stand in (terrain, forest, places). */
  survival?: SurvivalDef
  id: string
  name: string
  boxes: MapBox[]
  spawns: MapSpawn[]
  labels: MapLabel[]
  lighting: MapLighting
  lights?: MapLight[]
  /** Draw a city skyline around the map (outdoor view through windows). */
  skyline?: boolean
  pickups?: MapPickup[]
  /**
   * Area (x/z) to search for random spawn points; floor heights come from `spawns`. Without
   * it, only the fixed spawns are used.
   */
  spawnArea?: { min: [number, number]; max: [number, number] }
  /**
   * Shooting-range dummies: bots that stand exactly here facing `yaw`, never move, turn or
   * shoot, respawn in place, and don't count for scores.
   */
  targets?: MapSpawn[]
  /** Co-op map (zombies mode): the stages the team fights through, in order. */
  coop?: CoopDef
  /**
   * Walkable ways between floors (ramps), bottom → top, for the zombies' nav grid: each end
   * is a spot on a floor just off the ramp.
   */
  navLinks?: [Vec3, Vec3][]
}

/** An axis-aligned area (min/max corners, feet height included). */
export interface CoopZone {
  min: Vec3
  max: Vec3
}

/** What a stage asks of the team. */
export type CoopGoal =
  /** Kill this many zombies (scaled by the number of survivors). */
  | { kind: 'kill'; count: number }
  /** Any survivor gets into the zone. */
  | { kind: 'reach'; zone: CoopZone }
  /** Survivors stay in the zone this long in total (the clock only runs while someone is in). */
  | { kind: 'hold'; zone: CoopZone; seconds: number }
  /**
   * Survivors get to every spot, in any order, and stay `seconds` in each (switches, valves,
   * fuel cans to pick up: 0 s = just walk over it). `what` labels the spots on the HUD.
   */
  | { kind: 'activate'; spots: CoopZone[]; seconds: number; what: string }
  /**
   * Keep something alive for `seconds`: zombies that get to it tear at it (`health` points in
   * all), and if it breaks the stage starts over. `what` names it on the HUD.
   */
  | { kind: 'defend'; zone: CoopZone; seconds: number; health: number; what: string }
  /** Stay alive this long, anywhere. */
  | { kind: 'survive'; seconds: number }

export interface CoopStage {
  name: string
  /** The order on the HUD, e.g. "Clear the lobby". */
  task: string
  goal: CoopGoal
  /** Where survivors start (and come back) in this stage. */
  start: MapSpawn[]
  /** Where zombies come from in this stage (spots out of the team's sight are preferred). */
  zombieSpawns: Vec3[]
  /** Gate that opens when the stage is done (MapBox.gate). The last stage ends the map. */
  opens?: number
  /** Zombies at once, relative to normal (1). */
  intensity: number
  /** Share of zombies that are runners (fast, fragile). */
  runners: number
  /**
   * Weapon (WeaponId) everyone gets when the stage starts, unless they already carry one at
   * least as big (WEAPON_TIER): the further you get, the bigger the guns.
   */
  armory?: number
}

/** The areas a goal marks in the world (none for kill and survive goals). */
export function goalZones(goal: CoopGoal): CoopZone[] {
  if (goal.kind === 'activate') return goal.spots
  if (goal.kind === 'reach' || goal.kind === 'hold' || goal.kind === 'defend') return [goal.zone]
  return []
}

export interface CoopDef {
  stages: CoopStage[]
}

/** Is `p` (feet) inside the zone? */
export function inZone(zone: CoopZone, p: { x: number; y: number; z: number }): boolean {
  return (
    p.x >= zone.min[0] &&
    p.x <= zone.max[0] &&
    p.y >= zone.min[1] - 0.5 &&
    p.y <= zone.max[1] &&
    p.z >= zone.min[2] &&
    p.z <= zone.max[2]
  )
}

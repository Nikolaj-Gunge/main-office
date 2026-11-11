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

export interface MapDef {
  id: string
  name: string
  boxes: MapBox[]
  spawns: MapSpawn[]
  labels: MapLabel[]
  lighting: MapLighting
  lights?: MapLight[]
  /** Draw a city skyline around the map (outdoor view through windows). */
  skyline?: boolean
}

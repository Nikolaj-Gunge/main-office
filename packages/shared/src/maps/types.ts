export type Vec3 = readonly [number, number, number]

/** Surface materials. The client maps each to a texture; later the server maps them to impact/penetration rules. */
export const MATERIALS = ['floor', 'wall', 'cover', 'platform', 'marker', 'target', 'ramp'] as const
export type MaterialId = (typeof MATERIALS)[number]

/** Axis-aligned box, optionally rotated about its center (Euler XYZ, radians). Units are meters. */
export interface MapBox {
  center: Vec3
  size: Vec3
  rotation?: Vec3
  material: MaterialId
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
}

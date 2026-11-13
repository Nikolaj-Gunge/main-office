import type {
  CoopStage,
  MapBox,
  MapDef,
  MapLabel,
  MapLight,
  MapLighting,
  MapPickup,
  MapSpawn,
  MaterialId,
  Vec3,
} from './types.ts'

/** Optional per-box flags (see MapBox). */
export interface BoxFlags {
  collide?: boolean
  render?: boolean
  gate?: number
  swing?: number
}

/**
 * Small authoring DSL for code-defined maps. Positions are given as *bottom-center*
 * (x, floorY, z) because that's how level metrics are thought about: "a 1.0 m block on the floor".
 */
export class MapBuilder {
  private readonly boxes: MapBox[] = []
  private readonly spawns: MapSpawn[] = []
  private readonly labels: MapLabel[] = []
  private readonly lights: MapLight[] = []
  private skyline = false
  private readonly pickups: MapPickup[] = []
  private spawnArea: MapDef['spawnArea']
  private readonly targets: MapSpawn[] = []
  private readonly stages: CoopStage[] = []
  private readonly navLinks: [Vec3, Vec3][] = []

  private readonly id: string
  private readonly name: string
  private readonly lighting: MapLighting

  constructor(id: string, name: string, lighting: MapLighting) {
    this.id = id
    this.name = name
    this.lighting = lighting
  }

  /** Box whose bottom face is centered on (x, y, z). */
  block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: MaterialId,
    flags: BoxFlags = {},
  ) {
    this.boxes.push({ center: [x, y + h / 2, z], size: [w, h, d], material, ...flags })
    return this
  }

  /** Box spanning two opposite corners (any order). */
  span(a: Vec3, b: Vec3, material: MaterialId, flags: BoxFlags = {}) {
    const min = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])] as const
    const max = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] as const
    this.boxes.push({
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      material,
      ...flags,
    })
    return this
  }

  /** A raw box (centre + size), e.g. a rotated piece of decoration. */
  box(box: MapBox) {
    this.boxes.push(box)
    return this
  }

  /**
   * Ramp rising toward -Z (or +Z with `toward` = 1). Its top surface starts at floor height `y`
   * at z = `zStart` and climbs `run` meters (horizontal) at `angleDeg`. Returns the height reached.
   */
  ramp(
    x: number,
    y: number,
    zStart: number,
    width: number,
    run: number,
    angleDeg: number,
    material: MaterialId = 'ramp',
    toward: -1 | 1 = -1,
  ) {
    const a = (angleDeg * Math.PI) / 180
    const thickness = 0.3
    const length = run / Math.cos(a)
    const rise = run * Math.tan(a)
    // Top-surface center, then push down half the thickness along the ramp normal
    // (0, cos a, ∓sin a — it leans back toward where the ramp rises).
    const top = [x, y + rise / 2, zStart + (toward * run) / 2] as const
    this.boxes.push({
      center: [
        top[0],
        top[1] - (Math.cos(a) * thickness) / 2,
        top[2] + (toward * Math.sin(a) * thickness) / 2,
      ],
      size: [width, thickness, length],
      rotation: [-toward * a, 0, 0],
      material,
    })
    return rise
  }

  /** A way between floors for the zombies' nav grid (see MapDef.navLinks). */
  navLink(bottom: Vec3, top: Vec3) {
    this.navLinks.push([bottom, top])
    return this
  }

  spawn(x: number, y: number, z: number, yawDeg = 0) {
    this.spawns.push({ pos: [x, y, z], yaw: (yawDeg * Math.PI) / 180 })
    return this
  }

  /** A training dummy standing here (feet), facing `yawDeg` (see MapDef.targets). */
  target(x: number, y: number, z: number, yawDeg = 0) {
    this.targets.push({ pos: [x, y, z], yaw: (yawDeg * Math.PI) / 180 })
    return this
  }

  light(light: MapLight) {
    this.lights.push(light)
    return this
  }

  /** The index the next light will get (to hang boxes from it, see MapBox.swing). */
  get nextLight(): number {
    return this.lights.length
  }

  /** A weapon lying here (feet of the weapon at y), back `respawn` s after it's taken. */
  pickup(x: number, y: number, z: number, weapon: number, respawn = 25) {
    this.pickups.push({ pos: [x, y, z], weapon, respawn })
    return this
  }

  /** Random spawns anywhere inside this x/z area (on the floors the fixed spawns stand on). */
  randomSpawnsIn(min: [number, number], max: [number, number]) {
    this.spawnArea = { min, max }
    return this
  }

  /** The next co-op stage (zombies mode), in play order. */
  stage(stage: CoopStage) {
    this.stages.push(stage)
    return this
  }

  withSkyline() {
    this.skyline = true
    return this
  }

  label(x: number, y: number, z: number, text: string) {
    this.labels.push({ pos: [x, y, z], text })
    return this
  }

  build(): MapDef {
    return {
      id: this.id,
      name: this.name,
      boxes: this.boxes,
      spawns: this.spawns,
      labels: this.labels,
      lighting: this.lighting,
      lights: this.lights,
      skyline: this.skyline,
      pickups: this.pickups,
      ...(this.spawnArea ? { spawnArea: this.spawnArea } : {}),
      ...(this.targets.length > 0 ? { targets: this.targets } : {}),
      ...(this.stages.length > 0 ? { coop: { stages: this.stages } } : {}),
      ...(this.navLinks.length > 0 ? { navLinks: this.navLinks } : {}),
    }
  }
}

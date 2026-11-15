import {
  floodAt,
  heightAt,
  PRINT_SECONDS,
  PRINTS_FROM,
  type SurvivalDef,
  snowCoverAt,
  type WeatherPast,
} from '@office-fps/shared'
import * as THREE from 'three'
import { TIER_SETTINGS, type TierSettings } from './device-tier.ts'

/**
 * What the weather leaves on the map, as you see it (ROADMAP 6.9): the swollen lake (the water
 * plane itself is wilds.ts's, raised from here), snow falling in a cold spell and lying on the
 * ground (the ground's tint is wet-ground.ts's), and footprints in it — yours, everyone's and the
 * dead's, little blocky prints that fade over a couple of minutes. How high the water is and how
 * much snow lies come from the weather alone (weather-effects.ts), as on the server.
 *
 * Everything here is pooled and capped by the device tier (snowflakes, footprints).
 */

/** The box of snow that travels with you (m): wide, tall, deep. */
const SNOW_BOX = new THREE.Vector3(36, 18, 36)
/** How fast flakes fall (m/s), and how far they drift side to side. */
const SNOW_FALL = 1.4
const SNOW_SWAY = 0.6
/** The most of each the pools are built for (the tier draws fewer). */
const MAX_FLAKES = 900
const MAX_PRINTS = 420
/** A print every this far along (m), set this far left and right of the line walked. */
const STRIDE = 0.75
const SPREAD = 0.14
/** How far from you prints are made at all (m). */
const PRINT_RANGE = 70
/** Seconds between looks at the water and the snow (they change over minutes). */
const LOOK_EVERY = 0.5

const PRINT_COLOR = new THREE.Color(0x4a5260)
const SNOW_COLOR = new THREE.Color(0xb4bcc8)

/** Something that walks about and leaves prints: where it was last printed, and which foot. */
interface Walker {
  x: number
  z: number
  left: boolean
  seen: number
}

export class WeatherMarks {
  readonly root = new THREE.Group()
  /** How swollen the lakes are and how much snow lies, 0–1 (looked at twice a second). */
  flood = 0
  snow = 0
  /** Dev and screenshots: hold these here, whatever the weather says. */
  override: { flood?: number; snow?: number } | null = null

  private readonly def: SurvivalDef
  private readonly flakes: THREE.InstancedMesh
  private readonly flakeSeed: Float32Array
  private readonly prints: THREE.InstancedMesh
  /** Each print's birth (s, performance clock), and where it is: x, y, z, yaw. */
  private readonly printAt: Float32Array
  private readonly printPos: Float32Array
  private printCursor = 0
  private readonly walkers = new Map<number, Walker>()
  private tier: TierSettings = TIER_SETTINGS.high
  private sinceLook = LOOK_EVERY
  private time = 0
  private readonly matrix = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly vec = new THREE.Vector3()
  private readonly scale = new THREE.Vector3(1, 1, 1)
  private readonly colour = new THREE.Color()
  private readonly up = new THREE.Vector3(0, 1, 0)

  constructor(def: SurvivalDef) {
    this.def = def
    this.root.name = 'weather-marks'

    // Snow: tiny white cubes (blocky like everything else), moved round you on the CPU.
    this.flakes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xdfe6ee, fog: true }),
      MAX_FLAKES,
    )
    this.flakes.name = 'snowflakes'
    this.flakes.frustumCulled = false
    this.flakes.count = 0
    this.flakeSeed = Float32Array.from({ length: MAX_FLAKES * 4 }, () => Math.random())

    // Footprints: flat dark boxes pressed into the snow, coloured back to snow as they fade.
    this.prints = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.13, 0.012, 0.27),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      MAX_PRINTS,
    )
    this.prints.name = 'footprints'
    this.prints.frustumCulled = false
    this.prints.count = 0
    this.prints.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PRINTS * 3),
      3,
    )
    this.printAt = new Float32Array(MAX_PRINTS).fill(-1e9)
    this.printPos = new Float32Array(MAX_PRINTS * 4)
    this.root.add(this.flakes, this.prints)
  }

  setTier(tier: TierSettings): void {
    this.tier = tier
  }

  /**
   * Every frame. `past` is the weather so far (null before the server has said), `snowing` how
   * hard it snows right now (0–1), `walkers` everyone to leave prints (you, the others, the dead).
   */
  update(
    dt: number,
    eye: THREE.Vector3,
    past: WeatherPast | null,
    snowing: number,
    indoors: boolean,
    walkers: Iterable<{ id: number; x: number; y: number; z: number; grounded: boolean }>,
  ): void {
    this.time += dt
    this.sinceLook += dt
    if (this.sinceLook >= LOOK_EVERY) {
      this.sinceLook = 0
      this.flood = past ? floodAt(past) : 0
      this.snow = past ? snowCoverAt(past) : 0
    }
    if (this.override?.flood !== undefined) this.flood = this.override.flood
    if (this.override?.snow !== undefined) this.snow = this.override.snow
    const falling =
      this.override?.snow !== undefined ? Math.max(snowing, this.override.snow) : snowing
    this.updateFlakes(eye, indoors ? 0 : falling)
    this.updatePrints(eye, walkers)
  }

  private updateFlakes(eye: THREE.Vector3, snowing: number): void {
    const count = Math.min(
      MAX_FLAKES,
      Math.round(this.tier.snowflakes * Math.min(1, snowing * 1.3)),
    )
    this.flakes.count = count
    if (count === 0) return
    const t = this.time
    const { x: bx, y: by, z: bz } = SNOW_BOX
    for (let i = 0; i < count; i++) {
      const r = i * 4
      const a = this.flakeSeed[r] as number
      const b = this.flakeSeed[r + 1] as number
      const c = this.flakeSeed[r + 2] as number
      const d = this.flakeSeed[r + 3] as number
      // Each flake falls through the box and wraps round it, so the box can follow you.
      const fall = SNOW_FALL * (0.7 + d * 0.6)
      const y = wrap(c * by - t * fall - eye.y, by)
      const x = wrap(a * bx + Math.sin(t * (0.6 + d) + a * 40) * SNOW_SWAY - eye.x, bx)
      const z = wrap(b * bz + Math.cos(t * (0.5 + c) + b * 40) * SNOW_SWAY - eye.z, bz)
      this.vec.set(eye.x + x, eye.y + y, eye.z + z)
      this.matrix.makeTranslation(this.vec.x, this.vec.y, this.vec.z)
      this.flakes.setMatrixAt(i, this.matrix)
    }
    this.flakes.instanceMatrix.needsUpdate = true
  }

  private updatePrints(
    eye: THREE.Vector3,
    walkers: Iterable<{ id: number; x: number; y: number; z: number; grounded: boolean }>,
  ): void {
    const cap = Math.min(MAX_PRINTS, this.tier.footprints)
    if (this.snow >= PRINTS_FROM) {
      for (const w of walkers) {
        if (Math.hypot(w.x - eye.x, w.z - eye.z) > PRINT_RANGE) continue
        let was = this.walkers.get(w.id)
        if (!was) {
          was = { x: w.x, z: w.z, left: false, seen: this.time }
          this.walkers.set(w.id, was)
        }
        was.seen = this.time
        const dx = w.x - was.x
        const dz = w.z - was.z
        const d = Math.hypot(dx, dz)
        if (d < STRIDE) continue
        // Off somewhere else at once (a respawn, a car): start the trail over.
        if (d > STRIDE * 6 || !w.grounded) {
          was.x = w.x
          was.z = w.z
          continue
        }
        const yaw = Math.atan2(dx, dz)
        const side = was.left ? -SPREAD : SPREAD
        was.left = !was.left
        const px = w.x + (dz / d) * side
        const pz = w.z - (dx / d) * side
        // On the ground (the feet may be on a step): no prints on roofs and floors far above.
        const ground = heightAt(this.def.terrain, px, pz)
        was.x = w.x
        was.z = w.z
        if (Math.abs(w.y - ground) > 0.6) continue
        this.addPrint(px, ground + 0.02, pz, yaw, cap)
      }
      // Forget walkers not seen for a while.
      if (this.walkers.size > 64) {
        for (const [id, w] of this.walkers) if (this.time - w.seen > 5) this.walkers.delete(id)
      }
    }
    this.drawPrints(cap)
  }

  private addPrint(x: number, y: number, z: number, yaw: number, cap: number): void {
    const i = this.printCursor % cap
    this.printCursor = (this.printCursor + 1) % cap
    this.printAt[i] = this.time
    this.printPos.set([x, y, z, yaw], i * 4)
  }

  /** Every print, fading from a dark press in the snow back to snow (and gone when melted). */
  private drawPrints(cap: number): void {
    let shown = 0
    for (let i = 0; i < cap; i++) {
      const age = this.time - (this.printAt[i] as number)
      if (age > PRINT_SECONDS || this.snow < PRINTS_FROM * 0.5) continue
      const p = i * 4
      this.quat.setFromAxisAngle(this.up, this.printPos[p + 3] as number)
      this.vec.set(
        this.printPos[p] as number,
        this.printPos[p + 1] as number,
        this.printPos[p + 2] as number,
      )
      this.matrix.compose(this.vec, this.quat, this.scale)
      this.prints.setMatrixAt(shown, this.matrix)
      const fade = Math.min(
        1,
        (age / PRINT_SECONDS) ** 1.5 + (1 - Math.min(1, this.snow / 0.6)) * 0.5,
      )
      this.colour.copy(PRINT_COLOR).lerp(SNOW_COLOR, fade)
      this.prints.setColorAt(shown, this.colour)
      shown++
    }
    this.prints.count = shown
    if (shown > 0) {
      this.prints.instanceMatrix.needsUpdate = true
      if (this.prints.instanceColor) this.prints.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    for (const m of [this.flakes, this.prints]) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
      m.dispose()
    }
  }
}

/** `v` wrapped into −size/2 … size/2. */
function wrap(v: number, size: number): number {
  return ((((v + size / 2) % size) + size) % size) - size / 2
}

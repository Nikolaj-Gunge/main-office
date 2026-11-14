import { GROUP_MAP, MAP_COLLISION_GROUPS, type PhysicsWorld, RAPIER } from '../physics/world.ts'
import { coverAt, heightAt, surfaceAt } from '../survival/terrain.ts'
import { Surface, type Terrain } from '../survival/types.ts'
import type { PlayerInput } from './input.ts'
import { Button } from './input.ts'
import type { PlayerState } from './player.ts'

/**
 * Cars: an arcade model, moved kinematically like players (Rapier only answers "where can I
 * go?"). The same step runs on the server and, for the driver, as client prediction.
 *
 * Car space: x right, y up, z backwards (the nose points down −z at yaw 0, like a player
 * looking at yaw 0). Positive yaw turns left; positive steer steers left.
 */
export interface VehicleState {
  /** The middle of the car, on the ground between the wheels. */
  x: number
  y: number
  z: number
  yaw: number
  vx: number
  vy: number
  vz: number
  /** Front wheels, −1 (full right) … 1 (full left). */
  steer: number
  /** Tilt following the ground (radians): nose up, right side up. */
  pitch: number
  roll: number
}

/** Half the body's length and width (m): its collision box. */
export const CAR_HALF_LENGTH = 2.2
export const CAR_HALF_WIDTH = 0.95
/** The box starts this far above the ground (kerbs and steps pass under it) … */
const CLEARANCE = 0.45
/** … and is this tall. */
const BOX_HEIGHT = 1.1
/** Wheels: half the distance between front and rear axles, and between left and right. */
const AXLE = 1.4
const TRACK = 0.85
const WHEELBASE = AXLE * 2

/** Engine and brakes (m/s²), top speeds (m/s). */
const ENGINE = 8.5
const BRAKE = 16
const REVERSE = 5
const REVERSE_TOP = 7
const HANDBRAKE = 7
const ROLLING = 1.2
const DRAG = 0.003
const GRAVITY = 15
/** Coming off a crest no faster than this (m/s up): small hops, not ski jumps. */
const MAX_LAUNCH = 4
/** How fast the wheels turn to full lock and back (per second). */
const STEER_RATE = 3.2
const STEER_RETURN = 5
/** Full lock at walking pace (radians); less the faster you go. */
const MAX_STEER = 0.6

/** What the ground under the car lets it do: top speed, how hard the tyres grip sideways. */
interface Grip {
  top: number
  grip: number
  /** Extra slowing on rough ground (m/s²). */
  rough: number
}
const ROAD: Grip = { top: 25, grip: 9, rough: 0 }

/** Roads, yards and clearings are packed dirt (see terrain.ts): fast. The forest is not. */
export function groundGrip(terrain: Terrain | null, x: number, z: number): Grip {
  if (!terrain) return ROAD
  const surface = surfaceAt(terrain, x, z)
  if (surface === Surface.Dirt) return ROAD
  if (surface === Surface.Sand) return { top: 9, grip: 4, rough: 2.5 }
  if (surface === Surface.Rock) return { top: 13, grip: 6, rough: 1.5 }
  if (surface === Surface.Meadow) return { top: 15, grip: 6.5, rough: 1 }
  // Forest: the thicker it is, the slower (roots, undergrowth, ruts).
  const cover = coverAt(terrain, x, z)
  return { top: 12 - cover * 4, grip: 5, rough: 1.8 + cover * 1.5 }
}

export interface VehicleEvents {
  /** The hardest the car hit something solid this step (m/s into it), 0 if nothing. */
  impact: number
}

/** Seats: driver front left, then front right, rear left, rear right. Car space (x, z). */
export const SEATS: readonly [number, number][] = [
  [-0.42, -0.15],
  [0.42, -0.15],
  [-0.42, 0.75],
  [0.42, 0.75],
]
/** Where people sitting in a car have their feet, relative to the car's ground point. */
export const SEAT_DROP = -0.35

/** Seat a world position: car-space (x, z) → world (x, z). */
export function carToWorld(s: VehicleState, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(s.yaw)
  const n = Math.sin(s.yaw)
  // Right = (cos, −sin), back = (sin, cos).
  return { x: s.x + lx * c + lz * n, z: s.z - lx * n + lz * c }
}

/** World (x, z) → car space (x right, z back). */
export function worldToCar(s: VehicleState, x: number, z: number): { x: number; z: number } {
  const dx = x - s.x
  const dz = z - s.z
  const c = Math.cos(s.yaw)
  const n = Math.sin(s.yaw)
  return { x: dx * c - dz * n, z: dx * n + dz * c }
}

/** How far a point is outside the car's body (m, 0 inside), on the ground plane. */
export function distanceToCar(s: VehicleState, x: number, z: number): number {
  const p = worldToCar(s, x, z)
  const ox = Math.max(0, Math.abs(p.x) - CAR_HALF_WIDTH)
  const oz = Math.max(0, Math.abs(p.z) - CAR_HALF_LENGTH)
  return Math.hypot(ox, oz)
}

/** Forward speed (m/s, negative backwards). */
export function forwardSpeed(s: VehicleState): number {
  return -s.vx * Math.sin(s.yaw) - s.vz * Math.cos(s.yaw)
}

export function createVehicleState(x: number, y: number, z: number, yaw: number): VehicleState {
  return { x, y, z, yaw, vx: 0, vy: 0, vz: 0, steer: 0, pitch: 0, roll: 0 }
}

export function cloneVehicleState(s: VehicleState): VehicleState {
  return { ...s }
}

const yawRotation = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })

/** The car's collision box, as others bump into it: the body, from the sills to the roof. */
const BODY_HALF = { x: CAR_HALF_WIDTH, y: 0.65, z: CAR_HALF_LENGTH }
const BODY_LIFT = 0.25 + BODY_HALF.y
/** What the car itself is moved with: a box above the kerbs. */
const MOVE_HALF = { x: CAR_HALF_WIDTH, y: BOX_HEIGHT / 2, z: CAR_HALF_LENGTH }
const MOVE_LIFT = CLEARANCE + BOX_HEIGHT / 2
/** Gap kept from what the car stops against (m). */
const SKIN = 0.03

/**
 * A car's presence in a physics world: a box everyone else bumps into (it counts as the map,
 * so walls of people, bullets and the dead all stop at it), and the queries that move it.
 */
export class VehicleBody {
  readonly collider: RAPIER.Collider
  private readonly physics: PhysicsWorld
  private readonly terrain: Terrain | null
  private readonly moveShape = new RAPIER.Cuboid(MOVE_HALF.x, MOVE_HALF.y, MOVE_HALF.z)
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  private readonly notGround: (c: RAPIER.Collider) => boolean

  constructor(physics: PhysicsWorld, terrain: Terrain | null) {
    this.physics = physics
    this.terrain = terrain
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BODY_HALF.x, BODY_HALF.y, BODY_HALF.z).setCollisionGroups(
        MAP_COLLISION_GROUPS,
      ),
    )
    const ground = physics.ground
    this.notGround = (c) => c !== ground
  }

  /** Moves the box to where the car is (others see it after the world's next step). */
  place(s: VehicleState): void {
    this.collider.setTranslation({ x: s.x, y: s.y + BODY_LIFT, z: s.z })
    this.collider.setRotation(yawRotation(s.yaw))
  }

  free(): void {
    this.physics.world.removeCollider(this.collider, false)
  }

  /** What the ground under the car is like. */
  grip(x: number, z: number): Grip {
    return groundGrip(this.terrain, x, z)
  }

  /** Height of whatever is under (x, z), looking down from `from`: ground, a kerb, a floor. */
  groundAt(x: number, z: number, from: number): number {
    this.ray.origin = { x, y: from, z }
    const hit = this.physics.world.castRay(
      this.ray,
      6,
      true,
      undefined,
      QUERY_GROUPS,
      this.collider,
    )
    // Starting inside something (a wall): not a floor.
    if (hit && hit.timeOfImpact > 0) return from - hit.timeOfImpact
    return this.terrain ? heightAt(this.terrain, x, z) : from - 1
  }

  /** Would the car fit here, turned to `yaw`? */
  fits(x: number, y: number, z: number, yaw: number): boolean {
    return (
      this.physics.world.intersectionWithShape(
        { x, y: y + MOVE_LIFT, z },
        yawRotation(yaw),
        this.moveShape,
        undefined,
        QUERY_GROUPS,
        this.collider,
        undefined,
        this.notGround,
      ) === null
    )
  }

  /**
   * Moves the car by (dx, dz), sliding along what it runs into. Returns the unit normal of the
   * last thing hit (pointing out of it), or null.
   */
  sweep(s: VehicleState, dx: number, dz: number): { x: number; z: number } | null {
    let hitNormal: { x: number; z: number } | null = null
    for (let i = 0; i < 3; i++) {
      const length = Math.hypot(dx, dz)
      if (length < 1e-5) break
      const hit = this.physics.world.castShape(
        { x: s.x, y: s.y + MOVE_LIFT, z: s.z },
        yawRotation(s.yaw),
        { x: dx, y: 0, z: dz },
        this.moveShape,
        0,
        1,
        false,
        undefined,
        QUERY_GROUPS,
        this.collider,
        undefined,
        this.notGround,
      )
      if (!hit) {
        s.x += dx
        s.z += dz
        break
      }
      const t = Math.max(0, hit.time_of_impact - SKIN / length)
      s.x += dx * t
      s.z += dz * t
      let nx = hit.normal1.x
      let nz = hit.normal1.z
      const n = Math.hypot(nx, nz)
      if (n < 1e-3) {
        nx = -dx / length
        nz = -dz / length
      } else {
        nx /= n
        nz /= n
      }
      hitNormal = { x: nx, z: nz }
      // What is left of the move, along the wall.
      const rx = dx * (1 - t)
      const rz = dz * (1 - t)
      const into = rx * nx + rz * nz
      dx = rx - nx * Math.min(0, into)
      dz = rz - nz * Math.min(0, into)
      if (into >= 0) break
    }
    return hitNormal
  }
}

/** Car queries see the map (and other cars), never people or foliage. */
const QUERY_GROUPS = (GROUP_MAP << 16) | GROUP_MAP

/** Turns `value` towards `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step)
}

/** Ground heights under the four wheels: front left, front right, rear left, rear right. */
function wheelHeights(s: VehicleState, body: VehicleBody): [number, number, number, number] {
  const from = s.y + 0.8
  const h = (lx: number, lz: number) => {
    const p = carToWorld(s, lx, lz)
    return body.groundAt(p.x, p.z, from)
  }
  return [h(-TRACK, -AXLE), h(TRACK, -AXLE), h(-TRACK, AXLE), h(TRACK, AXLE)]
}

/**
 * How a particular car drives (see car-condition.ts): engine power (0 = it won't go, only
 * rolls and brakes), share of the top speed, and how hard it pulls to one side (−1 … 1).
 */
export interface DriveTune {
  power: number
  top: number
  pull: number
}

const AS_NEW: DriveTune = { power: 1, top: 1, pull: 0 }
/** Full pull steers this far (radians) when you let go of the wheel. */
const PULL_STEER = 0.05

/**
 * One tick of driving. `buttons`: Forward = throttle, Back = brake then reverse, Left / Right
 * steer, Jump = handbrake. An empty car is stepped with 0 and rolls to a stop.
 */
export function stepVehicle(
  s: VehicleState,
  buttons: number,
  dt: number,
  body: VehicleBody,
  tune: DriveTune = AS_NEW,
): VehicleEvents {
  const events: VehicleEvents = { impact: 0 }
  const throttle = (buttons & Button.Forward ? 1 : 0) - (buttons & Button.Back ? 1 : 0)
  const steerIn = (buttons & Button.Left ? 1 : 0) - (buttons & Button.Right ? 1 : 0)
  const handbrake = (buttons & Button.Jump) !== 0

  const before = wheelHeights(s, body)
  const ground = (before[0] + before[1] + before[2] + before[3]) / 4
  const onGround = s.y <= ground + 0.08

  // The wheels turn (whether or not they touch the ground).
  const steerRate = steerIn !== 0 && steerIn * s.steer >= 0 ? STEER_RATE : STEER_RETURN
  s.steer = approach(s.steer, steerIn, steerRate * dt)

  let fx = -Math.sin(s.yaw)
  let fz = -Math.cos(s.yaw)
  let forward = s.vx * fx + s.vz * fz
  let side = s.vx * fz - s.vz * fx

  if (onGround) {
    const terrainGrip = body.grip(s.x, s.z)
    // A worn engine (or a flat) doesn't reach the top speed a good one would.
    const g = { ...terrainGrip, top: terrainGrip.top * tune.top }
    // Engine, brakes and reverse (a dead engine only rolls and brakes).
    if (throttle > 0) {
      if (forward < -0.3) forward = approach(forward, 0, BRAKE * dt)
      else forward += ENGINE * tune.power * Math.max(0, 1 - Math.max(0, forward) / g.top) * dt
    } else if (throttle < 0) {
      if (forward > 0.3) forward = approach(forward, 0, BRAKE * dt)
      else
        forward -= REVERSE * tune.power * Math.max(0, 1 - Math.max(0, -forward) / REVERSE_TOP) * dt
    } else forward = approach(forward, 0, (ROLLING + g.rough) * dt)
    if (handbrake) forward = approach(forward, 0, HANDBRAKE * dt)
    // Too fast for this ground (off the road at speed): it drags you down quickly.
    if (Math.abs(forward) > g.top)
      forward = approach(forward, 0, (Math.abs(forward) - g.top) * 1.5 * dt)
    forward = approach(forward, 0, (g.rough * 0.25 + DRAG * forward * forward) * dt)
    // Uphill slows you, downhill speeds you up.
    forward -= Math.sin(s.pitch) * GRAVITY * 0.55 * dt

    // Steering: a bicycle model, the lock easing off at speed. The handbrake swings the tail.
    // (A bent axle or a flat pulls it to one side.)
    const angle = (s.steer * MAX_STEER + tune.pull * PULL_STEER) / (1 + Math.abs(forward) / 14)
    const yawRate = (forward * Math.tan(angle)) / WHEELBASE
    const turn = yawRate * dt * (handbrake ? 1.45 : 1)
    if (turn !== 0) {
      const yaw = s.yaw + turn
      // Don't swing the nose into a wall (unless already stuck in one).
      if (body.fits(s.x, s.y, s.z, yaw) || !body.fits(s.x, s.y, s.z, s.yaw)) s.yaw = yaw
    }
    // The tyres grip sideways (less with the handbrake on: you slide).
    const grip = handbrake ? g.grip * 0.22 : g.grip
    side *= Math.exp(-grip * dt)
    fx = -Math.sin(s.yaw)
    fz = -Math.cos(s.yaw)
  }
  // Velocity along the (new) heading, plus whatever slide is left.
  s.vx = fx * forward + fz * side
  s.vz = fz * forward - fx * side

  // Move, sliding along walls; hitting one hard costs speed (and the car its paint).
  const before2 = { x: s.vx, z: s.vz }
  const normal = body.sweep(s, s.vx * dt, s.vz * dt)
  if (normal) {
    const into = before2.x * normal.x + before2.z * normal.z
    if (into < 0) {
      events.impact = -into
      s.vx -= normal.x * into
      s.vz -= normal.z * into
      // Scraping along it.
      const keep = Math.max(0.3, 1 - events.impact * 0.06)
      s.vx *= keep
      s.vz *= keep
    }
  }

  // Up and down: follow the ground, leave it over a crest, fall back onto it.
  const wheels = wheelHeights(s, body)
  const target = (wheels[0] + wheels[1] + wheels[2] + wheels[3]) / 4
  const lastY = s.y
  s.vy -= GRAVITY * dt
  s.y += s.vy * dt
  if (s.y <= target) {
    s.vy = Math.min(MAX_LAUNCH, Math.max(-20, (target - lastY) / dt))
    s.y = target
  }
  // Lean with the ground under the wheels (eased, so a kerb rocks it rather than snapping).
  const pitch = Math.atan2((wheels[0] + wheels[1] - wheels[2] - wheels[3]) / 2, WHEELBASE)
  const roll = Math.atan2((wheels[1] + wheels[3] - wheels[0] - wheels[2]) / 2, TRACK * 2)
  const ease = Math.min(1, dt * (s.y > target + 0.05 ? 2 : 12))
  s.pitch += (pitch - s.pitch) * ease
  s.roll += (roll - s.roll) * ease
  return events
}

/**
 * A tick for someone sitting in a car: they look around (and their buttons are remembered for
 * the next press of E), but the car carries them; the server puts them in their seat.
 */
export function stepSeated(state: PlayerState, input: PlayerInput): void {
  state.prevButtons = input.buttons
  state.yaw = input.yaw
  state.pitch = input.pitch
  state.vel = { x: 0, y: 0, z: 0 }
}

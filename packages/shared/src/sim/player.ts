import type { MapSpawn } from '../maps/types.ts'
import {
  type PhysicsWorld,
  PLAYER_COLLISION_GROUPS,
  PLAYER_QUERY_GROUPS,
  RAPIER,
} from '../physics/world.ts'
import { viewDirection } from './hitboxes.ts'
import { Button, hasButton, type PlayerInput } from './input.ts'
import type { MovementConfig } from './movement-config.ts'
import {
  createWeaponState,
  DEFAULT_WEAPON_RULES,
  pelletDirections,
  stepWeapon,
  switchWeapons,
  type WeaponEvents,
  type WeaponRules,
  type WeaponState,
} from './weapon-sim.ts'
import { WEAPONS, WeaponId } from './weapons.ts'

export interface MutVec3 {
  x: number
  y: number
  z: number
}

/** Everything that defines a player's movement. Plain data: cloneable, serializable, replayable. */
export interface PlayerState {
  /** Feet position (bottom of the capsule). */
  pos: MutVec3
  vel: MutVec3
  yaw: number
  pitch: number
  /** Collider is in the crouched shape. */
  crouched: boolean
  /** 0 = standing eye height, 1 = crouched eye height. Animated, drives the camera. */
  crouchAmount: number
  grounded: boolean
  /** Seconds since last grounded (coyote time). */
  airTime: number
  /** Seconds a jump press stays queued. */
  jumpBuffer: number
  prevButtons: number
  /** Dead players don't move or shoot; the server flips this and respawns them. */
  alive: boolean
  /** The weapon in your hands. */
  weapon: WeaponState
  /**
   * The other weapon, keeping its own ammo and timers — or null when the primary slot is empty
   * (you spawn with only the handgun and pick rifles/snipers up from the floor).
   */
  holstered: WeaponState | null
}

/** A fired bullet: eye position and (spread-adjusted) unit direction. */
export interface ShotEvent {
  origin: MutVec3
  /** Where the gun points (the first pellet's direction). */
  dir: MutVec3
  /** Every ray of the shot: just `dir` for most guns, one per pellet for the shotgun. */
  pellets: MutVec3[]
  shotIndex: number
}

export interface StepEvents {
  jumped: boolean
  landed: boolean
  /** Downward speed at the moment of landing (m/s), 0 if not landing. */
  landingSpeed: number
  shot: ShotEvent | null
  weapon: WeaponEvents | null
  /** Switched weapons this tick. */
  switched: boolean
}

/** Gap Rapier keeps between the capsule and the world. Feet sit this far above the floor. */
const SKIN = 0.02
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

export function createPlayerState(
  spawn?: MapSpawn,
  weapon: WeaponState = createWeaponState(WeaponId.Rifle),
  holstered: WeaponState | null = createWeaponState(WeaponId.Handgun),
): PlayerState {
  return {
    pos: { x: spawn?.pos[0] ?? 0, y: spawn?.pos[1] ?? 0, z: spawn?.pos[2] ?? 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn?.yaw ?? 0,
    pitch: 0,
    crouched: false,
    crouchAmount: 0,
    grounded: false,
    airTime: 0,
    jumpBuffer: 0,
    prevButtons: 0,
    alive: true,
    weapon,
    holstered,
  }
}

export function clonePlayerState(s: PlayerState): PlayerState {
  return {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    weapon: { ...s.weapon },
    holstered: s.holstered ? { ...s.holstered } : null,
  }
}

export function eyeHeight(state: PlayerState, config: MovementConfig): number {
  return (
    config.standEyeHeight + (config.crouchEyeHeight - config.standEyeHeight) * state.crouchAmount
  )
}

/** A player's Rapier collider + character controller. One per simulated player. */
export class PlayerBody {
  readonly collider: RAPIER.Collider
  private readonly controller: RAPIER.KinematicCharacterController
  private readonly physics: PhysicsWorld
  private height: number
  config: MovementConfig
  /** Server rules for shooting (spread, infinite ammo); set alongside `config`. */
  weaponRules: WeaponRules = DEFAULT_WEAPON_RULES

  constructor(physics: PhysicsWorld, config: MovementConfig) {
    this.physics = physics
    this.config = config
    this.height = config.standHeight
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(
        capsuleHalfHeight(config.standHeight, config.radius),
        config.radius,
      ).setCollisionGroups(PLAYER_COLLISION_GROUPS),
    )
    this.controller = physics.world.createCharacterController(SKIN)
    this.controller.setUp({ x: 0, y: 1, z: 0 })
    // Snapping is done by PlayerBody.move so it follows the same rules as stepping.
    this.controller.disableSnapToGround()
    this.configure(config)
  }

  /** Re-applies tunables (call after live-editing the config). */
  configure(config: MovementConfig): void {
    this.config = config
    this.controller.setMinSlopeSlideAngle((config.maxSlopeDeg * Math.PI) / 180)
    this.applyShape()
  }

  /** Switches the capsule to `height` (no-op if already there). */
  setHeight(height: number): void {
    if (height === this.height) return
    this.height = height
    this.applyShape()
  }

  private applyShape(): void {
    this.collider.setShape(
      new RAPIER.Capsule(capsuleHalfHeight(this.height, this.config.radius), this.config.radius),
    )
  }

  /** Would a capsule of `height` fit at these feet without touching anything? */
  fits(feet: MutVec3, height: number): boolean {
    const r = this.config.radius - 0.01
    const shape = new RAPIER.Capsule(capsuleHalfHeight(height, r), r)
    const center = { x: feet.x, y: feet.y + SKIN + 0.01 + height / 2, z: feet.z }
    return (
      this.physics.world.intersectionWithShape(
        center,
        IDENTITY,
        shape,
        undefined,
        PLAYER_QUERY_GROUPS,
        this.collider,
      ) === null
    )
  }

  /**
   * Moves from `feet` by `delta` with collide-and-slide, plus step-up and ground snap when
   * `allowStep` (grounded at the start of the tick).
   * Only grounded players step — otherwise a 1.0 m jump plus a 0.4 m step would climb ledges the
   * metrics say are out of reach.
   */
  move(feet: MutVec3, delta: MutVec3, allowStep: boolean): MoveResult {
    const result = allowStep
      ? this.moveWithStep(feet, delta)
      : this.sweep(feet, delta, SWEEP_NORMAL)
    // Ground snap: walking down stairs or off a small ledge keeps you on the ground instead of
    // flying off in a little arc (matters for footsteps, jump timing and accuracy).
    if (allowStep && !result.grounded && delta.y <= 0) {
      const snap = this.sweep(
        add(feet, result.moved),
        { x: 0, y: -this.config.snapToGround, z: 0 },
        SWEEP_SNAP,
      )
      if (snap.grounded) {
        return { moved: add(result.moved, snap.moved), grounded: true, normals: result.normals }
      }
    }
    return result
  }

  private moveWithStep(feet: MutVec3, delta: MutVec3): MoveResult {
    const plain = this.sweep(feet, delta, SWEEP_NORMAL)
    const wantH = Math.hypot(delta.x, delta.z)
    const plainH = Math.hypot(plain.moved.x, plain.moved.z)
    if (wantH < 1e-6 || plainH >= wantH * 0.98) return plain
    // Slowed by a walkable slope (walking up a ramp), not by a wall: let the slope carry us.
    // Stepping here would hop up onto the ramp ahead and drop back — a ramp that feels like stairs.
    const walkable = Math.cos((this.config.maxSlopeDeg * Math.PI) / 180)
    const wall = plain.normals.some((n) => n.y < walkable && n.y > -0.5)
    if (!wall) return plain

    const rise = this.findStep(feet, delta.x / wantH, delta.z / wantH)
    if (rise === null) return plain

    // Lift exactly onto the step, then do the real horizontal move from there.
    const up = this.sweep(feet, { x: 0, y: rise, z: 0 }, SWEEP_RIGID)
    const p1 = add(feet, up.moved)
    const across = this.sweep(p1, { x: delta.x, y: 0, z: delta.z }, SWEEP_NORMAL)
    const stepped = add(up.moved, across.moved)
    if (Math.hypot(stepped.x, stepped.z) <= plainH + 1e-3) return plain
    return { moved: stepped, grounded: true, normals: across.normals }
  }

  /**
   * Probes for a step in direction (dirX, dirZ): rise by the step height, move forward up to a
   * capsule diameter, then raycast down from the capsule's center. Returns the height of the
   * walkable surface found there above `feet`, or null if there is no climbable step.
   *
   * The center ray (not the capsule's round bottom) is the ground truth, so resting on a step's
   * corner never counts — that is what keeps 0.5 m steps and 1.2 m ledges out of reach.
   */
  private findStep(feet: MutVec3, dirX: number, dirZ: number): number | null {
    const c = this.config
    const up = this.sweep(feet, { x: 0, y: c.stepHeight, z: 0 }, SWEEP_RIGID)
    const lookahead = c.radius * 2
    const p1 = add(feet, up.moved)
    const across = this.sweep(p1, { x: dirX * lookahead, y: 0, z: dirZ * lookahead }, SWEEP_RIGID)
    const p2 = add(p1, across.moved)

    const ray = new RAPIER.Ray({ x: p2.x, y: p2.y + 0.05, z: p2.z }, { x: 0, y: -1, z: 0 })
    const hit = this.physics.world.castRayAndGetNormal(
      ray,
      up.moved.y + 0.1,
      true,
      undefined,
      PLAYER_QUERY_GROUPS,
      this.collider,
    )
    if (!hit) return null
    const rise = p2.y + 0.05 - hit.timeOfImpact - feet.y
    const walkable = Math.cos((c.maxSlopeDeg * Math.PI) / 180)
    if (hit.normal.y < walkable || rise < 0.01 || rise > c.stepHeight + 0.01) return null
    return rise
  }

  /**
   * Collide-and-slide sweep. Moves with both horizontal and vertical parts are split into two
   * sweeps: Rapier's capsule-vs-box sweep occasionally stalls on flat floors when a diagonal move
   * also carries the small downward gravity component; horizontal-only sweeps never do.
   */
  private sweep(feet: MutVec3, delta: MutVec3, mode: SweepMode): MoveResult {
    const hasH = delta.x !== 0 || delta.z !== 0
    if (!hasH || delta.y === 0) return this.sweepOnce(feet, delta, mode)
    const h = this.sweepOnce(feet, { x: delta.x, y: 0, z: delta.z }, mode)
    const v = this.sweepOnce(add(feet, h.moved), { x: 0, y: delta.y, z: 0 }, mode)
    return {
      moved: add(h.moved, v.moved),
      grounded: v.grounded,
      normals: [...h.normals, ...v.normals],
    }
  }

  private sweepOnce(feet: MutVec3, delta: MutVec3, mode: SweepMode): MoveResult {
    const c = this.controller
    c.setSlideEnabled(mode.slide)
    c.setMaxSlopeClimbAngle(mode.climb ? (this.config.maxSlopeDeg * Math.PI) / 180 : 0)
    this.collider.setTranslation({ x: feet.x, y: feet.y + SKIN + this.height / 2, z: feet.z })
    c.computeColliderMovement(this.collider, delta, undefined, PLAYER_QUERY_GROUPS)
    const moved = c.computedMovement()
    const normals: MutVec3[] = []
    for (let i = 0; i < c.numComputedCollisions(); i++) {
      const hit = c.computedCollision(i)
      // normal2 points into the obstacle; flip it to get the surface normal facing the player.
      if (hit) normals.push({ x: -hit.normal2.x, y: -hit.normal2.y, z: -hit.normal2.z })
    }
    // Rapier also reports "grounded" when the capsule's round bottom rests on a ledge's edge;
    // only count it when we're touching something actually walkable.
    const walkable = Math.cos((this.config.maxSlopeDeg * Math.PI) / 180)
    return {
      moved: { x: moved.x, y: moved.y, z: moved.z },
      grounded: c.computedGrounded() && normals.some((n) => n.y >= walkable),
      normals,
    }
  }

  free(): void {
    this.physics.world.removeCharacterController(this.controller)
    this.physics.world.removeCollider(this.collider, false)
  }
}

interface SweepMode {
  slide: boolean
  climb: boolean
}
const SWEEP_NORMAL: SweepMode = { slide: true, climb: true }
const SWEEP_RIGID: SweepMode = { slide: false, climb: false }
/** Sliding lets the snap slip off a step's corner onto the tread below. */
const SWEEP_SNAP: SweepMode = { slide: true, climb: false }

interface MoveResult {
  moved: MutVec3
  grounded: boolean
  /** Surface normals of everything touched, facing the player. */
  normals: MutVec3[]
}

function add(a: MutVec3, b: MutVec3): MutVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function capsuleHalfHeight(height: number, radius: number): number {
  return Math.max(0.01, height / 2 - radius)
}

/** Quake-style acceleration toward `wishSpeed` along `wishDir`. */
function accelerate(
  vel: MutVec3,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
) {
  const current = vel.x * wishX + vel.z * wishZ
  const add = wishSpeed - current
  if (add <= 0) return
  const step = Math.min(accel * wishSpeed * dt, add)
  vel.x += step * wishX
  vel.z += step * wishZ
}

function applyFriction(vel: MutVec3, config: MovementConfig, dt: number) {
  const speed = Math.hypot(vel.x, vel.z)
  if (speed < 0.05) {
    vel.x = 0
    vel.z = 0
    return
  }
  const control = Math.max(speed, config.stopSpeed)
  const scale = Math.max(0, speed - control * config.friction * dt) / speed
  vel.x *= scale
  vel.z *= scale
}

/**
 * Advances one player by one fixed tick. Deterministic given (state, input, dt, world), so the
 * client can predict with it and the server can authoritatively replay it.
 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  body: PlayerBody,
): StepEvents {
  const c = body.config
  const buttons = input.buttons
  const pressed = buttons & ~state.prevButtons
  state.prevButtons = buttons
  state.yaw = input.yaw
  state.pitch = input.pitch
  const events: StepEvents = {
    jumped: false,
    landed: false,
    landingSpeed: 0,
    shot: null,
    weapon: null,
    switched: false,
  }
  if (!state.alive) return events

  // The state may have been reset (reconciliation, respawn): make the capsule match it.
  body.setHeight(state.crouched ? c.crouchHeight : c.standHeight)

  // --- Crouch: shrink instantly, stand up only when there's head room ----------------------
  // In mid-air, crouching pulls the feet up instead of lowering the head (CS crouch-jump), so a
  // crouch-jump clears higher ledges; the eye moves with the head, so the view barely changes.
  const wantCrouch = hasButton(buttons, Button.Crouch)
  const tuck = state.grounded ? 0 : Math.min(c.crouchJumpLift, c.standHeight - c.crouchHeight)
  const eyeRange = Math.max(1e-6, c.standEyeHeight - c.crouchEyeHeight)
  if (wantCrouch && !state.crouched) {
    state.crouched = true
    body.setHeight(c.crouchHeight)
    if (tuck > 0 && body.fits({ ...state.pos, y: state.pos.y + tuck }, c.crouchHeight)) {
      state.pos.y += tuck
      state.crouchAmount = Math.min(1, state.crouchAmount + tuck / eyeRange)
    }
  } else if (!wantCrouch && state.crouched) {
    const lowered = { ...state.pos, y: state.pos.y - tuck }
    if (tuck > 0 && body.fits(lowered, c.standHeight)) {
      // Legs back down in the air.
      state.pos.y = lowered.y
      state.crouchAmount = Math.max(0, state.crouchAmount - tuck / eyeRange)
      state.crouched = false
      body.setHeight(c.standHeight)
    } else if (body.fits(state.pos, c.standHeight)) {
      state.crouched = false
      body.setHeight(c.standHeight)
    }
  }
  const crouchTarget = state.crouched ? 1 : 0
  const crouchStep = c.crouchTransitionSpeed * dt
  state.crouchAmount += Math.max(
    -crouchStep,
    Math.min(crouchStep, crouchTarget - state.crouchAmount),
  )

  // --- Wish direction --------------------------------------------------------------------
  const forward =
    (hasButton(buttons, Button.Forward) ? 1 : 0) - (hasButton(buttons, Button.Back) ? 1 : 0)
  const strafe =
    (hasButton(buttons, Button.Right) ? 1 : 0) - (hasButton(buttons, Button.Left) ? 1 : 0)
  const sin = Math.sin(state.yaw)
  const cos = Math.cos(state.yaw)
  let wishX = -sin * forward + cos * strafe
  let wishZ = -cos * forward - sin * strafe
  const wishLen = Math.hypot(wishX, wishZ)
  if (wishLen > 0) {
    wishX /= wishLen
    wishZ /= wishLen
  }
  // Holding fire cancels sprint, so you can always start shooting (after sprintToFire). Aiming
  // also stops sprinting — and with a scope, Shift holds your breath instead.
  const aiming = hasButton(buttons, Button.Aim)
  const sprinting =
    hasButton(buttons, Button.Sprint) &&
    forward > 0 &&
    !state.crouched &&
    !aiming &&
    !hasButton(buttons, Button.Fire)
  const handling = WEAPONS[state.weapon.id].moveSpeedFactor * (aiming ? 0.6 : 1)
  const maxSpeed =
    (state.crouched ? c.crouchSpeed : c.walkSpeed * (sprinting ? c.sprintMultiplier : 1)) * handling
  const wishSpeed = wishLen > 0 ? maxSpeed : 0

  // --- Jump (buffered press + coyote time) -----------------------------------------------
  state.jumpBuffer = hasButton(pressed, Button.Jump)
    ? c.jumpBufferTime
    : Math.max(0, state.jumpBuffer - dt)
  const canJump = state.grounded || state.airTime < c.coyoteTime
  if (state.jumpBuffer > 0 && canJump) {
    state.vel.y = c.jumpVelocity
    state.grounded = false
    state.airTime = c.coyoteTime // no second jump from coyote time
    state.jumpBuffer = 0
    events.jumped = true
  }

  // --- Horizontal velocity ---------------------------------------------------------------
  if (state.grounded) {
    applyFriction(state.vel, c, dt)
    accelerate(state.vel, wishX, wishZ, wishSpeed, c.groundAccel, dt)
  } else {
    // Air control without speed gain: no strafe-jumping/bhop past your top speed.
    const before = Math.hypot(state.vel.x, state.vel.z)
    accelerate(state.vel, wishX, wishZ, wishSpeed, c.airAccel, dt)
    const after = Math.hypot(state.vel.x, state.vel.z)
    const limit = Math.max(before, wishSpeed)
    if (after > limit) {
      state.vel.x *= limit / after
      state.vel.z *= limit / after
    }
  }

  // --- Vertical: average of old and new velocity = exact integration of constant gravity ----
  const vyBefore = state.vel.y
  state.vel.y -= c.gravity * dt
  const delta = {
    x: state.vel.x * dt,
    y: ((vyBefore + state.vel.y) / 2) * dt,
    z: state.vel.z * dt,
  }

  // --- Collide ---------------------------------------------------------------------------
  const wasGrounded = state.grounded
  const result = body.move(state.pos, delta, wasGrounded)
  state.pos.x += result.moved.x
  state.pos.y += result.moved.y
  state.pos.z += result.moved.z
  state.grounded = result.grounded && state.vel.y <= 0

  // Clip velocity against what we actually hit, so we slide along walls instead of keeping
  // momentum into them. Skipped when the move went through (e.g. a successful auto-step).
  const desiredH = Math.hypot(delta.x, delta.z)
  const movedH = Math.hypot(result.moved.x, result.moved.z)
  const blockedH = movedH < desiredH * 0.98
  const walkable = Math.cos((c.maxSlopeDeg * Math.PI) / 180)
  for (const n of result.normals) {
    if (n.y >= walkable) continue // floor
    if (n.y < -0.5) {
      if (state.vel.y > 0) state.vel.y = 0 // head hit a ceiling
      continue
    }
    if (!blockedH) continue
    // Clip against the wall's horizontal normal only: a ledge's edge pushes back, but must
    // never add upward speed (that turned 1.0 m jumps into 1.2 m climbs).
    const len = Math.hypot(n.x, n.z)
    if (len < 1e-4) continue
    const nx = n.x / len
    const nz = n.z / len
    const into = state.vel.x * nx + state.vel.z * nz
    if (into < 0) {
      state.vel.x -= nx * into
      state.vel.z -= nz * into
    }
  }

  if (state.grounded) {
    if (!wasGrounded) {
      events.landed = true
      events.landingSpeed = Math.max(0, -vyBefore)
    }
    state.vel.y = 0
    state.airTime = 0
  } else {
    state.airTime += dt
  }

  // --- Weapon: switch first, then fire — after movement, so shots leave from where you are ---
  const isPrimary = state.weapon.id !== WeaponId.Handgun
  const wantSwitch =
    hasButton(pressed, Button.SwapWeapon) ||
    (hasButton(pressed, Button.Slot1) && !isPrimary) ||
    (hasButton(pressed, Button.Slot2) && isPrimary)
  if (wantSwitch && state.holstered) {
    ;[state.weapon, state.holstered] = switchWeapons(state.weapon, state.holstered)
    events.switched = true
  }
  events.weapon = stepWeapon(state.weapon, buttons, pressed, dt, {
    sprinting,
    grounded: state.grounded,
    crouched: state.crouched,
    speedFactor: Math.hypot(state.vel.x, state.vel.z) / c.walkSpeed,
    rules: body.weaponRules,
  })
  const shot = events.weapon.shot
  if (shot) {
    const dir = viewDirection(state.yaw + shot.yawOffset, state.pitch + shot.pitchOffset)
    const w = state.weapon
    events.shot = {
      origin: { x: state.pos.x, y: state.pos.y + eyeHeight(state, c), z: state.pos.z },
      dir,
      pellets: pelletDirections(
        dir,
        shot.pelletSpread,
        WEAPONS[w.id].pellets ?? 1,
        w.spreadSeed,
        shot.shotIndex,
      ),
      shotIndex: shot.shotIndex,
    }
  }

  return events
}

import type { MapSpawn } from '../maps/types.ts'
import {
  PERSON_QUERY_GROUPS,
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
  /** The third item you carry (usually the knife), or null. */
  pocket: WeaponState | null
  /** Breath for sprinting, 0–1 (only runs down when the config limits sprinting). */
  stamina: number
  /** Out of breath: no sprinting until some of it is back. */
  winded: boolean
  /** Lying down: the collider is in the prone shape. */
  prone: boolean
  /** 0 = up, 1 = flat on the ground. Animated: getting down and up takes a moment. */
  proneAmount: number
  /** Seconds of slide left (0 = not sliding). */
  slide: number
  /** Seconds before another slide is allowed. */
  slideCooldown: number
  /** Climbing onto a ledge: a short scripted move (null when not climbing). */
  mantle: Mantle | null
}

/** A climb onto a ledge: pulled straight up beside it, then over onto the top. */
export interface Mantle {
  from: MutVec3
  to: MutVec3
  /** Seconds since it started, and how long it takes. */
  time: number
  duration: number
  /** Not enough head room on top to stand: arrive crouched. */
  crouch: boolean
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
  /** Started a slide / a climb, lay down or got up this tick (sounds). */
  slid: boolean
  mantled: boolean
  proned: boolean
}

/** Winded until this much breath is back. */
const WIND_BACK = 0.3

/** Gap Rapier keeps between the capsule and the world. Feet sit this far above the floor. */
const SKIN = 0.02
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

export function createPlayerState(
  spawn?: MapSpawn,
  weapon: WeaponState = createWeaponState(WeaponId.Rifle),
  holstered: WeaponState | null = createWeaponState(WeaponId.Handgun),
  pocket: WeaponState | null = createWeaponState(WeaponId.Knife),
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
    pocket,
    stamina: 1,
    winded: false,
    prone: false,
    proneAmount: 0,
    slide: 0,
    slideCooldown: 0,
    mantle: null,
  }
}

/** Everything a player carries: in hand first, then the last-used, then the rest. */
export function carried(s: PlayerState): WeaponState[] {
  const out = [s.weapon]
  if (s.holstered) out.push(s.holstered)
  if (s.pocket) out.push(s.pocket)
  return out
}

/**
 * Puts `target` (one of the carried items) in your hand. The weapon you had goes to the
 * "last used" spot, so Q flips between the two most recent.
 */
export function drawWeapon(s: PlayerState, target: WeaponState): void {
  if (target === s.weapon) return
  const [now, prev] = switchWeapons(s.weapon, target)
  if (s.pocket === target) s.pocket = s.holstered
  s.holstered = prev
  s.weapon = now
}

export function clonePlayerState(s: PlayerState): PlayerState {
  return {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    weapon: { ...s.weapon },
    holstered: s.holstered ? { ...s.holstered } : null,
    pocket: s.pocket ? { ...s.pocket } : null,
    mantle: s.mantle ? { ...s.mantle, from: { ...s.mantle.from }, to: { ...s.mantle.to } } : null,
  }
}

export function eyeHeight(state: PlayerState, config: MovementConfig): number {
  const upright =
    config.standEyeHeight + (config.crouchEyeHeight - config.standEyeHeight) * state.crouchAmount
  const eye = upright + (config.proneEyeHeight - upright) * state.proneAmount
  return eye - config.slideEyeDrop * slideWeight(state, config)
}

/** How far into a slide's low pose (0–1): drops in quickly, rises as the slide runs out. */
export function slideWeight(state: PlayerState, config: MovementConfig): number {
  if (state.slide <= 0) return 0
  const elapsed = config.slideTime - state.slide
  return Math.min(1, elapsed * 8, state.slide * 5)
}

/** Capsule height for the shape the player is in. */
export function bodyHeight(state: PlayerState, config: MovementConfig): number {
  if (state.mantle) return config.crouchHeight
  return state.prone
    ? config.proneHeight
    : state.crouched
      ? config.crouchHeight
      : config.standHeight
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
  /** Can pull itself up onto ledges (the dead can't: crates and sills stay safe from them). */
  climbs = true

  /** What the body bumps into: the map, plus foliage unless it goes through it. */
  private readonly groups: number

  /** `throughFoliage`: zombies and bots walk through corn; people don't (see GROUP_FOLIAGE). */
  constructor(physics: PhysicsWorld, config: MovementConfig, throughFoliage = false) {
    this.physics = physics
    this.groups = throughFoliage ? PLAYER_QUERY_GROUPS : PERSON_QUERY_GROUPS
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
        this.groups,
        this.collider,
      ) === null
    )
  }

  /** Normal of the walkable ground right under `feet`, or null (for slides down slopes). */
  groundNormal(feet: MutVec3): MutVec3 | null {
    const ray = new RAPIER.Ray({ x: feet.x, y: feet.y + 0.2, z: feet.z }, { x: 0, y: -1, z: 0 })
    const hit = this.physics.world.castRayAndGetNormal(
      ray,
      0.5,
      true,
      undefined,
      this.groups,
      this.collider,
    )
    return hit ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : null
  }

  /**
   * A ledge to climb in direction (dirX, dirZ): a wall within reach whose walkable top is
   * `minRise`–`maxRise` above `feet`, with room to pull up beside it, to move over it and to be
   * on top (standing, or at least crouched). Returns the climb, or null.
   */
  findLedge(
    feet: MutVec3,
    dirX: number,
    dirZ: number,
    minRise: number,
    maxRise: number,
  ): { to: MutVec3; rise: number; crouch: boolean } | null {
    const c = this.config
    const reach = c.radius + c.mantleReach
    // The wall: probed just above step height, then at waist and chest height.
    let wall = -1
    for (const h of [
      c.stepHeight + 0.05,
      0.95 * (c.standHeight / 1.8),
      1.45 * (c.standHeight / 1.8),
    ]) {
      if (h > maxRise) break
      const ray = new RAPIER.Ray(
        { x: feet.x, y: feet.y + h, z: feet.z },
        { x: dirX, y: 0, z: dirZ },
      )
      const hit = this.physics.world.castRayAndGetNormal(
        ray,
        reach,
        true,
        undefined,
        this.groups,
        this.collider,
      )
      if (hit && Math.abs(hit.normal.y) < 0.7) {
        wall = hit.timeOfImpact
        break
      }
    }
    if (wall < 0) return null
    // Its top, just past the face. A ray starting inside something taller hits at once (too high).
    const top = feet.y + maxRise + 0.05
    const probe = { x: feet.x + dirX * (wall + 0.15), y: top, z: feet.z + dirZ * (wall + 0.15) }
    const down = this.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(probe, { x: 0, y: -1, z: 0 }),
      maxRise + 0.05 - minRise,
      true,
      undefined,
      this.groups,
      this.collider,
    )
    if (!down) return null
    const rise = top - down.timeOfImpact - feet.y
    const walkable = Math.cos((c.maxSlopeDeg * Math.PI) / 180)
    if (rise < minRise || rise > maxRise || down.normal.y < walkable) return null
    const y = feet.y + rise
    // Over the edge far enough that the whole capsule is above the top.
    const ahead = wall + c.radius + 0.12
    const to = { x: feet.x + dirX * ahead, y, z: feet.z + dirZ * ahead }
    // Room to rise beside the wall (no ceiling), to move across, and to be there.
    for (const t of [0, 0.35, 0.7, 1]) {
      const at = { x: feet.x + (to.x - feet.x) * t, y: y + 0.02, z: feet.z + (to.z - feet.z) * t }
      if (!this.fits(at, c.crouchHeight)) return null
    }
    return { to, rise, crouch: !this.fits(to, c.standHeight) }
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
      this.groups,
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
    c.computeColliderMovement(this.collider, delta, undefined, this.groups)
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

function applyFriction(
  vel: MutVec3,
  config: MovementConfig,
  dt: number,
  stopSpeed = config.stopSpeed,
) {
  const speed = Math.hypot(vel.x, vel.z)
  if (speed < 0.05) {
    vel.x = 0
    vel.z = 0
    return
  }
  const control = Math.max(speed, stopSpeed)
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
    slid: false,
    mantled: false,
    proned: false,
  }
  if (!state.alive) return events
  state.slideCooldown = Math.max(0, state.slideCooldown - dt)
  const sin = Math.sin(state.yaw)
  const cos = Math.cos(state.yaw)

  // --- Climbing onto a ledge: scripted; nothing else moves you until you're up ---------------
  if (state.mantle) {
    stepMantle(state, body, dt)
    stepItems(state, buttons & ~HANDS_BUSY, pressed & ~HANDS_BUSY, dt, body, events, false)
    return events
  }

  // The state may have been reset (reconciliation, respawn): make the capsule match it.
  body.setHeight(bodyHeight(state, c))

  // --- Prone: Z lies down flat (on the ground) and gets back up; jump or crouch gets up only to
  // a crouch. Getting up needs head room for the shape you get up into.
  const wantCrouch = hasButton(buttons, Button.Crouch)
  if (state.prone) {
    const toCrouch = hasButton(pressed, Button.Jump) || hasButton(pressed, Button.Crouch)
    if (hasButton(pressed, Button.Prone) || toCrouch) {
      const stand = !toCrouch && !wantCrouch && body.fits(state.pos, c.standHeight)
      if (stand || body.fits(state.pos, c.crouchHeight)) {
        state.prone = false
        state.crouched = !stand
        body.setHeight(bodyHeight(state, c))
        events.proned = true
      }
    }
  } else if (hasButton(pressed, Button.Prone) && state.grounded) {
    state.prone = true
    state.crouched = false
    endSlide(state, c)
    body.setHeight(c.proneHeight)
    events.proned = true
  }

  // --- Slide: crouch while sprinting drops you into a slide that carries your speed ----------
  const speedNow = Math.hypot(state.vel.x, state.vel.z)
  if (
    hasButton(pressed, Button.Crouch) &&
    hasButton(buttons, Button.Sprint) &&
    hasButton(buttons, Button.Forward) &&
    !state.prone &&
    state.grounded &&
    state.slide === 0 &&
    state.slideCooldown === 0 &&
    speedNow > c.walkSpeed * 1.1
  ) {
    state.slide = c.slideTime
    state.crouched = true
    body.setHeight(c.crouchHeight)
    state.vel.x *= c.slideBoost
    state.vel.z *= c.slideBoost
    events.slid = true
  }

  // --- Crouch: shrink instantly, stand up only when there's head room ----------------------
  // In mid-air, crouching pulls the feet up instead of lowering the head (CS crouch-jump), so a
  // crouch-jump clears higher ledges; the eye moves with the head, so the view barely changes.
  // A slide keeps you down whatever the key does.
  const holdDown = wantCrouch || state.slide > 0
  const tuck = state.grounded ? 0 : Math.min(c.crouchJumpLift, c.standHeight - c.crouchHeight)
  const eyeRange = Math.max(1e-6, c.standEyeHeight - c.crouchEyeHeight)
  if (state.prone) {
    // Lying down: the crouch key does nothing more.
  } else if (holdDown && !state.crouched) {
    state.crouched = true
    body.setHeight(c.crouchHeight)
    if (tuck > 0 && body.fits({ ...state.pos, y: state.pos.y + tuck }, c.crouchHeight)) {
      state.pos.y += tuck
      state.crouchAmount = Math.min(1, state.crouchAmount + tuck / eyeRange)
    }
  } else if (!holdDown && state.crouched) {
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
  const crouchTarget = state.crouched || state.prone ? 1 : 0
  const crouchStep = c.crouchTransitionSpeed * dt
  state.crouchAmount += Math.max(
    -crouchStep,
    Math.min(crouchStep, crouchTarget - state.crouchAmount),
  )
  const proneStep = dt / Math.max(1e-3, c.proneTime)
  state.proneAmount += Math.max(
    -proneStep,
    Math.min(proneStep, (state.prone ? 1 : 0) - state.proneAmount),
  )
  // Getting down or up: hardly any movement until you're there.
  const lying = state.prone || state.proneAmount > 0.05
  const settling = state.proneAmount > 0.05 && state.proneAmount < 0.95

  // --- Wish direction --------------------------------------------------------------------
  const forward =
    (hasButton(buttons, Button.Forward) ? 1 : 0) - (hasButton(buttons, Button.Back) ? 1 : 0)
  const strafe =
    (hasButton(buttons, Button.Right) ? 1 : 0) - (hasButton(buttons, Button.Left) ? 1 : 0)
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
    !lying &&
    !aiming &&
    !hasButton(buttons, Button.Fire) &&
    !state.winded
  if (c.sprintSeconds > 0) {
    if (sprinting && wishLen > 0) {
      state.stamina = Math.max(0, state.stamina - dt / c.sprintSeconds)
      if (state.stamina === 0) state.winded = true
    } else {
      state.stamina = Math.min(1, state.stamina + dt / c.breathSeconds)
      if (state.stamina >= WIND_BACK) state.winded = false
    }
  }
  const handling = WEAPONS[state.weapon.id].moveSpeedFactor * (aiming ? 0.6 : 1)
  const gait = state.prone
    ? c.proneSpeed
    : state.crouched
      ? c.crouchSpeed
      : c.walkSpeed * (sprinting ? c.sprintMultiplier : 1)
  const maxSpeed = gait * handling * (settling ? 0.3 : 1)
  const wishSpeed = wishLen > 0 ? maxSpeed : 0

  // --- Jump (buffered press + coyote time); at a ledge, forward + jump climbs it instead ------
  state.jumpBuffer = hasButton(pressed, Button.Jump)
    ? c.jumpBufferTime
    : Math.max(0, state.jumpBuffer - dt)
  const canJump = !lying && (state.grounded || state.airTime < c.coyoteTime)
  const grab = state.grounded ? state.jumpBuffer > 0 : hasButton(buttons, Button.Jump)
  if (!lying && forward > 0 && grab && body.climbs) {
    // From the ground: anything from waist to over your head. In the air (holding jump into a
    // wall) the hands are already up there: lower ledges only, so a jump can't scale a house.
    const ledge = state.grounded
      ? body.findLedge(state.pos, -sin, -cos, c.mantleMinHeight, c.mantleMaxHeight)
      : body.findLedge(state.pos, -sin, -cos, c.mantleMinHeight * 0.5, c.mantleMaxHeight * 0.6)
    if (ledge) {
      const size = c.standHeight / 1.8
      state.mantle = {
        from: { ...state.pos },
        to: ledge.to,
        time: 0,
        duration: 0.4 + (0.15 * ledge.rise) / size,
        crouch: ledge.crouch,
      }
      endSlide(state, c)
      state.jumpBuffer = 0
      state.vel = { x: 0, y: 0, z: 0 }
      state.grounded = false
      body.setHeight(c.crouchHeight)
      events.mantled = true
      stepItems(state, buttons & ~HANDS_BUSY, pressed & ~HANDS_BUSY, dt, body, events, false)
      return events
    }
  }
  if (state.jumpBuffer > 0 && canJump) {
    state.vel.y = c.jumpVelocity
    state.grounded = false
    state.airTime = c.coyoteTime // no second jump from coyote time
    state.jumpBuffer = 0
    events.jumped = true
    endSlide(state, c)
  }

  // --- Horizontal velocity ---------------------------------------------------------------
  if (state.slide > 0 && !state.grounded) endSlide(state, c) // slid off an edge
  if (state.slide > 0) {
    stepSlide(state, body, dt)
  } else if (state.grounded) {
    // Crawling is slower than the stop speed: friction scaled down so a crawl reaches its pace.
    applyFriction(state.vel, c, dt, state.prone ? Math.min(c.stopSpeed, c.proneSpeed) : c.stopSpeed)
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

  stepItems(state, buttons, pressed, dt, body, events, sprinting)
  return events
}

/** Buttons that do nothing while both hands are busy climbing. */
const HANDS_BUSY = Button.Fire | Button.Aim

/** Weapons for one tick: switch first, then fire — after movement, so shots leave from where you are. */
function stepItems(
  state: PlayerState,
  buttons: number,
  pressed: number,
  dt: number,
  body: PlayerBody,
  events: StepEvents,
  sprinting: boolean,
): void {
  const c = body.config
  // 1 = main gun, 2 = handgun, 3 = knife, Q / wheel = the last one you had.
  const items = carried(state)
  const target = hasButton(pressed, Button.Slot1)
    ? items.find((w) => WEAPONS[w.id].slot === 'primary')
    : hasButton(pressed, Button.Slot2)
      ? items.find((w) => WEAPONS[w.id].slot === 'sidearm')
      : hasButton(pressed, Button.Slot3)
        ? items.find((w) => WEAPONS[w.id].slot === 'melee')
        : hasButton(pressed, Button.SwapWeapon)
          ? (state.holstered ?? undefined)
          : undefined
  if (target && target !== state.weapon) {
    drawWeapon(state, target)
    events.switched = true
  }
  events.weapon = stepWeapon(state.weapon, buttons, pressed, dt, {
    sprinting,
    grounded: state.grounded,
    crouched: state.crouched || state.prone,
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
      pellets:
        WEAPONS[w.id].fireMode === 'melee'
          ? meleeFan(state.yaw + shot.yawOffset, state.pitch + shot.pitchOffset)
          : pelletDirections(
              dir,
              shot.pelletSpread,
              WEAPONS[w.id].pellets ?? 1,
              w.spreadSeed,
              shot.shotIndex,
            ),
      shotIndex: shot.shotIndex,
    }
  }
}

/** Ends a slide (and starts the wait before the next one). */
function endSlide(state: PlayerState, c: MovementConfig): void {
  if (state.slide <= 0) return
  state.slide = 0
  state.slideCooldown = c.slideCooldown
}

/**
 * One tick of a slide: no steering, speed bleeds away at `slideFriction` — unless the ground
 * falls away ahead, where gravity keeps you going (and the slide lasts longer). It ends when
 * the time runs out or you're down to crouching pace.
 */
function stepSlide(state: PlayerState, body: PlayerBody, dt: number): void {
  const c = body.config
  const speed = Math.hypot(state.vel.x, state.vel.z)
  const n = speed > 1e-6 ? body.groundNormal(state.pos) : null
  // The ground's normal leans the way it slopes down: along your path, that's sin(slope).
  const downhill = n && speed > 1e-6 ? (n.x * state.vel.x + n.z * state.vel.z) / speed : 0
  const top = c.walkSpeed * c.sprintMultiplier * c.slideBoost * 1.3
  const next = Math.min(top, Math.max(0, speed + (c.gravity * downhill - c.slideFriction) * dt))
  if (speed > 1e-6) {
    state.vel.x *= next / speed
    state.vel.z *= next / speed
  }
  state.slide = Math.max(0, state.slide - dt * (downhill > 0.05 ? 0.5 : 1))
  if (state.slide === 0 || next < c.crouchSpeed) {
    state.slide = 0
    state.slideCooldown = c.slideCooldown
  }
}

/** One tick of a climb: up beside the ledge first, then over onto it. */
function stepMantle(state: PlayerState, body: PlayerBody, dt: number): void {
  const m = state.mantle
  if (!m) return
  const c = body.config
  body.setHeight(c.crouchHeight)
  m.time = Math.min(m.duration, m.time + dt)
  const u = m.time / m.duration
  const ease = (t: number) => {
    const k = Math.max(0, Math.min(1, t))
    return k * k * (3 - 2 * k)
  }
  const up = ease(u / 0.55)
  const over = ease((u - 0.45) / 0.55)
  const next = {
    x: m.from.x + (m.to.x - m.from.x) * over,
    y: m.from.y + (m.to.y - m.from.y) * up,
    z: m.from.z + (m.to.z - m.from.z) * over,
  }
  state.vel = {
    x: (next.x - state.pos.x) / dt,
    y: (next.y - state.pos.y) / dt,
    z: (next.z - state.pos.z) / dt,
  }
  state.pos = next
  state.grounded = false
  state.airTime = 0
  state.jumpBuffer = 0
  if (u >= 1) {
    state.mantle = null
    state.pos = { ...m.to }
    state.vel.y = 0
    state.grounded = true
    state.crouched = m.crouch
    body.setHeight(bodyHeight(state, c))
  }
}

/**
 * A knife swing covers a small fan, not a line: the centre first (it wins ties), then a little
 * to each side and up/down, so you don't need pixel-perfect aim up close.
 */
function meleeFan(yaw: number, pitch: number): MutVec3[] {
  const out: MutVec3[] = []
  for (const [dy, dp] of [
    [0, 0],
    [-0.14, 0],
    [0.14, 0],
    [0, 0.12],
    [0, -0.12],
  ] as const) {
    out.push(viewDirection(yaw + dy, pitch + dp))
  }
  return out
}

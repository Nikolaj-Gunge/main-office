import {
  clonePlayerState,
  createPlayerState,
  createWeaponState,
  DEFAULT_MOVEMENT,
  type EffectId,
  eyeHeight,
  type GameRules,
  type InputCommand,
  type MapSpawn,
  type MovementConfig,
  movementFor,
  movementKey,
  type PhysicsWorld,
  PlayerBody,
  type PlayerInput,
  type PlayerState,
  Predictor,
  type Skills,
  type StepEvents,
  skillEffects,
  TICK_DT,
  tuneMovement,
  WeaponId,
  type WeaponRules,
  weaponRulesFor,
} from '@office-fps/shared'
import type { PerspectiveCamera } from 'three'
import { CameraFeel } from './camera-feel.ts'

/** Corrections bigger than this snap instantly (respawn/teleport) instead of being smoothed. */
const SNAP_DISTANCE = 2
/** How quickly a smoothed correction fades out (seconds to ~37%). */
const CORRECTION_SMOOTH_TIME = 0.1

/**
 * The player you control. Movement is predicted locally with the shared sim at the fixed tick
 * rate (instant response), then reconciled against the server's authoritative state. The camera
 * interpolates between the last two ticks so motion is smooth at any frame rate.
 */
export class LocalPlayer {
  readonly movement: MovementConfig = { ...DEFAULT_MOVEMENT }
  readonly body: PlayerBody
  readonly feel = new CameraFeel()
  readonly predictor: Predictor
  /** Distance of the last reconciliation correction (m), for the net debug readout. */
  lastCorrection = 0

  private prev: PlayerState
  /** Visual-only offset that hides small corrections by fading them out over a few frames. */
  private readonly smoothing = { x: 0, y: 0, z: 0 }
  /** 0 = alive, 1 = fully in the death-cam pose. */
  private death = 0

  constructor(physics: PhysicsWorld, spawn: MapSpawn | undefined) {
    this.body = new PlayerBody(physics, this.movement)
    // Offline / before joining you hold what a fresh spawn holds: just the handgun.
    this.predictor = new Predictor(
      createPlayerState(spawn, createWeaponState(WeaponId.Handgun), null),
      this.body,
    )
    this.prev = clonePlayerState(this.state)
  }

  get state(): PlayerState {
    return this.predictor.state
  }

  /** Movement as the rules have it, before survival's buffs and statuses (tuneMovement). */
  private baseMovement: MovementConfig = { ...DEFAULT_MOVEMENT }
  private effects: readonly EffectId[] = []
  private baseWeapon: WeaponRules | null = null
  /** Survival skills (skills.ts): what they change about running and weapon handling. */
  private skills = skillEffects(undefined)

  /** Server game rules: movement (gravity, speed, size…) and shooting (spread, ammo). */
  applyRules(rules: GameRules): void {
    this.baseWeapon = weaponRulesFor(rules)
    this.baseMovement = movementFor(rules)
    Object.assign(this.movement, tuneMovement(this.baseMovement, this.effects, this.skills.sprint))
    this.body.configure(this.movement)
    this.applyWeaponRules()
  }

  /** The rules' weapon handling, with this character's Aim and Melee (as the server has it). */
  private applyWeaponRules(): void {
    const fx = this.skills
    this.body.weaponRules = {
      ...(this.baseWeapon ?? this.body.weaponRules),
      aimSpeed: fx.aimSpeed,
      swayScale: fx.sway,
      swingTime: fx.swingTime,
    }
  }

  /** What a survival character has learned: predict running and handling the way the server does. */
  setSkills(skills: Skills | undefined): void {
    const fx = skillEffects(skills)
    const was = this.skills
    if (fx.sprint === was.sprint && fx.aimSpeed === was.aimSpeed && fx.swingTime === was.swingTime)
      return
    this.skills = fx
    this.applyWeaponRules()
    Object.assign(this.movement, tuneMovement(this.baseMovement, this.effects, fx.sprint))
    this.body.configure(this.movement)
  }

  /**
   * Survival's buffs and statuses (Well fed, a sprain…) change how you run: predict with the same
   * tuning the server uses.
   */
  setEffects(effects: readonly EffectId[]): void {
    if (movementKey(effects) === movementKey(this.effects)) return
    this.effects = effects
    Object.assign(this.movement, tuneMovement(this.baseMovement, effects, this.skills.sprint))
    this.body.configure(this.movement)
  }

  /** Re-applies `movement` after live edits. */
  applyMovement(): void {
    this.body.configure(this.movement)
  }

  /** Offline only: move the player (the server owns position when connected). */
  teleport(x: number, y: number, z: number): void {
    const s = clonePlayerState(this.state)
    s.pos = { x, y, z }
    s.vel = { x: 0, y: 0, z: 0 }
    this.predictor.reset(s)
    this.prev = clonePlayerState(s)
  }

  /**
   * Runs one predicted tick. `viewTick` is the server tick of what's on screen (lag compensation).
   * Returns the command to send to the server and what happened (shots, jumps…).
   */
  tick(input: PlayerInput, viewTick: number): { command: InputCommand; events: StepEvents } {
    this.prev = clonePlayerState(this.state)
    const result = this.predictor.predict(input, viewTick)
    this.feel.onTick(this.state, this.prev.pos.y, result.events, this.movement, TICK_DT)
    return result
  }

  /** Applies an authoritative snapshot of our own player. */
  onServerState(serverState: PlayerState, ackSeq: number): void {
    const c = this.predictor.reconcile(serverState, ackSeq)
    const distance = Math.hypot(c.x, c.y, c.z)
    if (distance === 0) return
    this.lastCorrection = distance

    if (distance > SNAP_DISTANCE) {
      this.prev = clonePlayerState(this.state)
      this.smoothing.x = this.smoothing.y = this.smoothing.z = 0
      return
    }
    // Shift the interpolation start with the correction, and hide the jump visually.
    this.prev.pos.x += c.x
    this.prev.pos.y += c.y
    this.prev.pos.z += c.z
    this.smoothing.x -= c.x
    this.smoothing.y -= c.y
    this.smoothing.z -= c.z
  }

  /** Forget prediction history (new connection). */
  resetPrediction(): void {
    this.predictor.reset(this.state)
    this.prev = clonePlayerState(this.state)
  }

  /**
   * Positions the camera. `alpha` (0–1) is how far real time is between the previous and current
   * tick. View angles come straight from the mouse, not the tick, so aiming never lags.
   */
  updateCamera(camera: PerspectiveCamera, alpha: number, yaw: number, pitch: number, dt: number) {
    const a = this.prev
    const b = this.state
    const lerp = (x: number, y: number) => x + (y - x) * alpha
    this.feel.update(b, this.movement, dt)

    const fade = Math.exp(-dt / CORRECTION_SMOOTH_TIME)
    this.smoothing.x *= fade
    this.smoothing.y *= fade
    this.smoothing.z *= fade

    // Dead: camera drops to the floor and tilts (until respawn moves us).
    const deathTarget = b.alive ? 0 : 1
    this.death += (deathTarget - this.death) * Math.min(1, dt * 6)
    const eye =
      lerp(eyeHeight(a, this.movement), eyeHeight(b, this.movement)) * (1 - this.death * 0.8)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)
    camera.position.set(
      lerp(a.pos.x, b.pos.x) + rightX * this.feel.offsetX + this.smoothing.x,
      lerp(a.pos.y, b.pos.y) + eye + this.feel.offsetY + this.smoothing.y,
      lerp(a.pos.z, b.pos.z) + rightZ * this.feel.offsetX + this.smoothing.z,
    )
    camera.rotation.set(pitch, yaw, this.feel.roll + this.death * 0.5, 'YXZ')
  }
}

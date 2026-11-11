import {
  clonePlayerState,
  createPlayerState,
  DEFAULT_MOVEMENT,
  eyeHeight,
  type MapSpawn,
  type MovementConfig,
  type PhysicsWorld,
  PlayerBody,
  type PlayerInput,
  type PlayerState,
  stepPlayer,
  TICK_DT,
} from '@office-fps/shared'
import type { PerspectiveCamera } from 'three'
import { CameraFeel } from './camera-feel.ts'

/**
 * The player you control: runs the shared movement sim at the fixed tick rate and places the
 * camera between the last two ticks so motion is smooth at any frame rate.
 */
export class LocalPlayer {
  readonly movement: MovementConfig = { ...DEFAULT_MOVEMENT }
  readonly body: PlayerBody
  readonly feel = new CameraFeel()
  state: PlayerState
  private prev: PlayerState

  constructor(physics: PhysicsWorld, spawn: MapSpawn | undefined) {
    this.body = new PlayerBody(physics, this.movement)
    this.state = createPlayerState(spawn)
    this.prev = clonePlayerState(this.state)
  }

  /** Re-applies `movement` after live edits. */
  applyMovement(): void {
    this.body.configure(this.movement)
  }

  teleport(x: number, y: number, z: number): void {
    this.state.pos = { x, y, z }
    this.state.vel = { x: 0, y: 0, z: 0 }
    this.prev = clonePlayerState(this.state)
  }

  tick(input: PlayerInput): void {
    this.prev = clonePlayerState(this.state)
    const events = stepPlayer(this.state, input, TICK_DT, this.body)
    this.feel.onTick(this.state, this.prev.pos.y, events, this.movement, TICK_DT)
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

    const eye = lerp(eyeHeight(a, this.movement), eyeHeight(b, this.movement))
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)
    camera.position.set(
      lerp(a.pos.x, b.pos.x) + rightX * this.feel.offsetX,
      lerp(a.pos.y, b.pos.y) + eye + this.feel.offsetY,
      lerp(a.pos.z, b.pos.z) + rightZ * this.feel.offsetX,
    )
    camera.rotation.set(pitch, yaw, this.feel.roll, 'YXZ')
  }
}

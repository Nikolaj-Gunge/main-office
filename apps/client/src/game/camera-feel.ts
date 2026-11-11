import { type MovementConfig, type PlayerState, Spring, type StepEvents } from '@office-fps/shared'

export interface CameraFeelConfig {
  /** Vertical head bob at walk speed (m). */
  bobHeight: number
  /** Side-to-side head bob at walk speed (m). */
  bobSway: number
  /** Distance covered per footstep (m). */
  strideLength: number
  /** Max camera roll when strafing at walk speed (degrees). */
  strafeRollDeg: number
  /** Camera dip per m/s of landing speed (m). */
  landingDip: number
  /** Seconds for the camera to catch up after stepping onto a stair. */
  stepSmoothTime: number
}

export const DEFAULT_CAMERA_FEEL: CameraFeelConfig = {
  bobHeight: 0.035,
  bobSway: 0.02,
  strideLength: 1.9,
  strafeRollDeg: 0.8,
  landingDip: 0.018,
  stepSmoothTime: 0.08,
}

/**
 * Head motion layered on top of the simulated eye position: bob, landing dip, strafe roll and
 * stair smoothing. Purely cosmetic — never feeds back into the simulation.
 */
export class CameraFeel {
  config = { ...DEFAULT_CAMERA_FEEL }
  /** Offsets to add to the camera this frame. */
  offsetX = 0
  offsetY = 0
  roll = 0
  onFootstep?: () => void

  /** Footstep cycle (radians, one step per π) — the viewmodel bobs in sync with it. */
  phase = 0
  /** 0 = standing still, 1 = walking, >1 = sprinting. */
  bobWeight = 0
  private readonly dip = new Spring(14)
  private stepOffset = 0

  /** Call once per simulation tick. `prevY` is the feet height before the tick. */
  onTick(
    state: PlayerState,
    prevY: number,
    events: StepEvents,
    movement: MovementConfig,
    dt: number,
  ) {
    const c = this.config
    const speed = Math.hypot(state.vel.x, state.vel.z)

    if (state.grounded && speed > 0.5) {
      const before = Math.floor(this.phase / Math.PI)
      this.phase += (speed / c.strideLength) * Math.PI * dt
      if (Math.floor(this.phase / Math.PI) !== before) this.onFootstep?.()
    }
    const targetWeight = state.grounded ? Math.min(speed / movement.walkSpeed, 1.4) : 0
    this.bobWeight += (targetWeight - this.bobWeight) * Math.min(1, dt * 10)

    if (events.landed && events.landingSpeed > 2) {
      this.dip.impulse(-events.landingSpeed * c.landingDip * 14)
      this.onFootstep?.()
    }

    // Stepping onto (or snapping down) a stair moves the feet instantly; let the eyes catch up.
    const rise = state.pos.y - prevY
    const isStep = Math.abs(rise) > 0.05 && Math.abs(rise) <= movement.stepHeight + 0.05
    if (state.grounded && !events.landed && isStep) this.stepOffset -= rise
  }

  /** Call once per rendered frame. */
  update(state: PlayerState, movement: MovementConfig, dt: number) {
    const c = this.config
    this.dip.update(dt)
    this.stepOffset *= Math.exp(-dt / Math.max(c.stepSmoothTime, 1e-3))

    // Vertical bob hits bottom on every footstep; sway swings once per two steps.
    this.offsetY =
      -Math.abs(Math.sin(this.phase)) * c.bobHeight * this.bobWeight +
      this.dip.value +
      this.stepOffset
    this.offsetX = Math.cos(this.phase) * c.bobSway * this.bobWeight

    // Roll into the strafe direction (velocity along the view's right vector).
    const right = state.vel.x * Math.cos(state.yaw) - state.vel.z * Math.sin(state.yaw)
    const targetRoll = (-right / movement.walkSpeed) * ((c.strafeRollDeg * Math.PI) / 180)
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8)
  }
}

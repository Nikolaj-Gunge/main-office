/**
 * Every movement tunable, in meters / seconds. Mirrors PLAN.md §4.1. Kept as plain data so the
 * client's debug panel can live-edit it and the server can later ship it to clients.
 */
export interface MovementConfig {
  /** Capsule. */
  radius: number
  standHeight: number
  crouchHeight: number
  standEyeHeight: number
  crouchEyeHeight: number
  /** Eye height transition speed (fraction of the full crouch per second). */
  crouchTransitionSpeed: number
  /**
   * Crouching in mid-air pulls your feet up this far (CS crouch-jump): a jump clears ~1 m, a
   * crouch-jump ~1.4 m — enough for 1.25 m ledges and crates.
   */
  crouchJumpLift: number

  walkSpeed: number
  sprintMultiplier: number
  crouchSpeed: number

  groundAccel: number
  airAccel: number
  friction: number
  /** Below this speed, friction acts as if moving at this speed: stops quickly instead of creeping. */
  stopSpeed: number

  gravity: number
  jumpVelocity: number
  /** Seconds after leaving the ground during which a jump is still allowed. */
  coyoteTime: number
  /** Seconds a jump press is remembered before landing. */
  jumpBufferTime: number

  stepHeight: number
  maxSlopeDeg: number
  snapToGround: number
}

export const DEFAULT_MOVEMENT: MovementConfig = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.2,
  standEyeHeight: 1.65,
  crouchEyeHeight: 1.1,
  crouchTransitionSpeed: 7,
  crouchJumpLift: 0.45,

  walkSpeed: 5.2,
  sprintMultiplier: 1.35,
  crouchSpeed: 2.4,

  groundAccel: 10,
  airAccel: 1.5,
  friction: 6,
  stopSpeed: 2.5,

  gravity: 20,
  // h = v² / 2g → 6.3² / 40 ≈ 0.99 m
  jumpVelocity: 6.3,
  coyoteTime: 0.1,
  jumpBufferTime: 0.1,

  stepHeight: 0.4,
  maxSlopeDeg: 46,
  snapToGround: 0.3,
}

/** Peak jump height implied by a config (for UI and tests). */
export function jumpHeight(config: MovementConfig): number {
  return (config.jumpVelocity * config.jumpVelocity) / (2 * config.gravity)
}

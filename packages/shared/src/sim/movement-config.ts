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
  /** Seconds of sprinting a full breath lasts (0 = sprint for ever). */
  sprintSeconds: number
  /** Seconds to get all your breath back. */
  breathSeconds: number

  /** Lying down: capsule height (≥ 2 × radius), eye height and crawl speed. */
  proneHeight: number
  proneEyeHeight: number
  proneSpeed: number
  /** Seconds to get down flat (or back up to a crouch). */
  proneTime: number

  /** Sliding (crouch while sprinting): how long, how fast it bleeds speed (m/s²), the kick. */
  slideTime: number
  slideFriction: number
  slideBoost: number
  /** Seconds after a slide before the next one. */
  slideCooldown: number
  /** How far the eyes drop below crouch height mid-slide (m). */
  slideEyeDrop: number

  /** Climbing onto ledges this high above your feet (forward + jump). */
  mantleMinHeight: number
  mantleMaxHeight: number
  /** How far in front of you (from the capsule's edge) a ledge can be grabbed (m). */
  mantleReach: number
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
  sprintSeconds: 0,
  breathSeconds: 13,

  proneHeight: 0.75,
  proneEyeHeight: 0.35,
  proneSpeed: 1.1,
  proneTime: 0.55,

  slideTime: 0.9,
  slideFriction: 5,
  slideBoost: 1.12,
  slideCooldown: 0.7,
  slideEyeDrop: 0.25,

  mantleMinHeight: 0.5,
  mantleMaxHeight: 2,
  mantleReach: 0.55,
}

/** Peak jump height implied by a config (for UI and tests). */
export function jumpHeight(config: MovementConfig): number {
  return (config.jumpVelocity * config.jumpVelocity) / (2 * config.gravity)
}

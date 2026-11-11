import type { PlayerInput } from '../sim/input.ts'

const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2

/** Yaw → u16 over a full turn (≈0.0055° steps). */
export function encodeYaw(yaw: number): number {
  const turns = (((yaw / TAU) % 1) + 1) % 1
  return Math.round(turns * 65536) & 0xffff
}

export function decodeYaw(q: number): number {
  return (q / 65536) * TAU
}

/** Pitch (±90°) → i16 (≈0.0027° steps). */
export function encodePitch(pitch: number): number {
  const clamped = Math.max(-HALF_PI, Math.min(HALF_PI, pitch))
  return Math.round((clamped / HALF_PI) * 32767)
}

export function decodePitch(q: number): number {
  return (q / 32767) * HALF_PI
}

/**
 * Snaps an input to exactly what survives the wire. The client must predict with the quantized
 * input, otherwise its replay and the server's simulation drift apart by rounding error.
 */
export function quantizeInput(input: PlayerInput): PlayerInput {
  return {
    buttons: input.buttons & 0xffff,
    yaw: decodeYaw(encodeYaw(input.yaw)),
    pitch: decodePitch(encodePitch(input.pitch)),
  }
}

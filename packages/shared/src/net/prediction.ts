import { TICK_DT } from '../constants.ts'
import type { InputCommand } from '../protocol/messages.ts'
import { quantizeInput } from '../protocol/quantize.ts'
import type { PlayerInput } from '../sim/input.ts'
import {
  clonePlayerState,
  type PlayerBody,
  type PlayerState,
  type StepEvents,
  stepPlayer,
} from '../sim/player.ts'

/** Unacknowledged inputs kept for replay. ~2 s at 60 Hz; older ones mean we're desynced. */
const MAX_PENDING = 120

/**
 * Client-side prediction with server reconciliation.
 *
 * Every tick the local input is applied immediately (no waiting for the server) and remembered.
 * When a snapshot arrives with the server's state after input `ackSeq`, we rewind to that state
 * and replay every newer input. With identical, deterministic simulation on both sides the
 * replayed result equals the old prediction, so corrections only happen on real disagreements.
 */
export class Predictor {
  state: PlayerState
  private readonly body: PlayerBody
  private pending: InputCommand[] = []
  private nextSeq = 1

  constructor(state: PlayerState, body: PlayerBody) {
    this.state = state
    this.body = body
  }

  get pendingCount(): number {
    return this.pending.length
  }

  /** Applies one tick of input locally. Returns the command to send to the server. */
  predict(input: PlayerInput): { command: InputCommand; events: StepEvents } {
    const command: InputCommand = { seq: this.nextSeq++, ...quantizeInput(input) }
    const events = stepPlayer(this.state, command, TICK_DT, this.body)
    this.pending.push(command)
    if (this.pending.length > MAX_PENDING) this.pending.shift()
    return { command, events }
  }

  /**
   * Rewinds to the authoritative `serverState` (the result of input `ackSeq`) and replays newer
   * inputs. Returns how far the predicted position moved because of it (0 when prediction held).
   */
  reconcile(serverState: PlayerState, ackSeq: number): { x: number; y: number; z: number } {
    const before = { ...this.state.pos }
    while (this.pending.length > 0 && (this.pending[0]?.seq ?? 0) <= ackSeq) this.pending.shift()

    this.state = clonePlayerState(serverState)
    for (const command of this.pending) stepPlayer(this.state, command, TICK_DT, this.body)

    return {
      x: this.state.pos.x - before.x,
      y: this.state.pos.y - before.y,
      z: this.state.pos.z - before.z,
    }
  }

  /** Forget everything (new connection or respawn). */
  reset(state: PlayerState): void {
    this.state = clonePlayerState(state)
    this.pending = []
    this.nextSeq = 1
  }
}

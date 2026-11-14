import { INPUT_BATCH_TICKS } from '../constants.ts'
import type { InputCommand } from '../protocol/messages.ts'
import { Button } from '../sim/input.ts'

/**
 * Pressing one of these sends the batch straight away instead of waiting for it to fill, so a
 * shot, jump, reload, use or weapon switch reaches the server as soon as it would have unbatched.
 * Holding them (a spray, a held W) doesn't: only the press edge flushes.
 */
export const FLUSH_BUTTONS =
  Button.Fire |
  Button.Jump |
  Button.Use |
  Button.Reload |
  Button.Slot1 |
  Button.Slot2 |
  Button.Slot3 |
  Button.SwapWeapon |
  Button.Prone

/**
 * Collects input commands (one per tick) into Input messages. Each incoming WebSocket message
 * is metered by Cloudflare, so we send one every `size` ticks — or earlier on a press of a
 * FLUSH_BUTTONS button. Commands carry their own seq, so prediction and the server's ack don't
 * care how they were grouped.
 */
export class InputBatcher {
  private readonly pending: InputCommand[] = []
  private prevButtons = 0
  private urgent = false
  readonly size: number

  constructor(size = INPUT_BATCH_TICKS) {
    this.size = Math.max(1, Math.floor(size))
  }

  /**
   * Adds a tick's command. True when the batch should go now (full, or a button was pressed);
   * the caller then sends `take()` — after the frame's last tick, so several ticks simulated in
   * one frame still leave as one message.
   */
  add(command: InputCommand): boolean {
    this.pending.push(command)
    const pressed = command.buttons & ~this.prevButtons & FLUSH_BUTTONS
    this.prevButtons = command.buttons
    if (pressed !== 0) this.urgent = true
    return this.ready
  }

  get ready(): boolean {
    return this.pending.length > 0 && (this.urgent || this.pending.length >= this.size)
  }

  /** Everything collected so far (possibly empty). */
  take(): InputCommand[] {
    this.urgent = false
    return this.pending.splice(0, this.pending.length)
  }

  /** Forget unsent commands (on disconnect). */
  reset(): void {
    this.pending.length = 0
    this.urgent = false
    this.prevButtons = 0
  }

  get pendingCount(): number {
    return this.pending.length
  }
}

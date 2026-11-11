/** Tracks held keys by `KeyboardEvent.code` (layout-independent: WASD works on AZERTY too). */
export class Keyboard {
  private readonly down = new Set<string>()
  /** Keys pressed since last `consumePressed`, so a tap shorter than one tick isn't lost. */
  private readonly pressed = new Set<string>()

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code)
      this.down.add(e.code)
      // Keep browser shortcuts like Ctrl+W from firing mid-game.
      if (document.pointerLockElement && e.code !== 'Escape') e.preventDefault()
    })
    target.addEventListener('keyup', (e) => this.down.delete(e.code))
    target.addEventListener('blur', () => this.down.clear())
  }

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** True if the key went down since the last call (then clears it). */
  consumePressed(code: string): boolean {
    return this.pressed.delete(code)
  }

  /** -1, 0 or 1 from a pair of keys. */
  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0)
  }
}

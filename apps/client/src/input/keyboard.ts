/**
 * Tracks held keys by `KeyboardEvent.code` (layout-independent: WASD works on AZERTY too), plus
 * mouse buttons as `Mouse0` (left), `Mouse1` (middle), `Mouse2` (right) while the pointer is locked.
 */
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
    target.addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) return
      this.pressed.add(`Mouse${e.button}`)
      this.down.add(`Mouse${e.button}`)
    })
    target.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`))
    // Each wheel notch is a one-off press of `Wheel`.
    target.addEventListener('wheel', (e) => {
      if (document.pointerLockElement && Math.abs(e.deltaY) > 0) this.pressed.add('Wheel')
    })
    // Right-click to aim must not open the context menu.
    target.addEventListener('contextmenu', (e) => {
      if (document.pointerLockElement) e.preventDefault()
    })
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this.down.clear()
    })
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

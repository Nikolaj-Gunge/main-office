const DEG = Math.PI / 180
/** Source/CS m_yaw: degrees per mouse count at sensitivity 1. */
const M_YAW = 0.022
const MAX_PITCH = 89 * DEG
/** Chrome occasionally reports huge bogus deltas when the lock engages; drop those. */
const MAX_DELTA = 400

/**
 * Pointer-locked mouse look. Requests raw (unaccelerated) input where supported, so the same
 * sensitivity feels identical across machines — expected by anyone coming from CS.
 */
export class MouseLook {
  yaw = 0
  pitch = 0
  sensitivity = 2
  onLockChange?: (locked: boolean) => void

  constructor(private readonly element: HTMLElement) {
    document.addEventListener('pointerlockchange', () => this.onLockChange?.(this.locked))
    document.addEventListener('mousemove', (e) => this.onMove(e))
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element
  }

  async lock(): Promise<void> {
    if (this.locked) return
    try {
      await this.element.requestPointerLock({ unadjustedMovement: true })
    } catch {
      // Raw input unsupported (e.g. Safari, some Linux setups): fall back to accelerated input.
      await this.element.requestPointerLock()
    }
  }

  private onMove(e: MouseEvent): void {
    if (!this.locked) return
    if (Math.abs(e.movementX) > MAX_DELTA || Math.abs(e.movementY) > MAX_DELTA) return
    const k = this.sensitivity * M_YAW * DEG
    this.yaw -= e.movementX * k
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * k))
  }
}

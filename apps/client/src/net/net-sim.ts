/**
 * Fake bad network for testing netcode on localhost: delays traffic in both directions by
 * `latencyMs` ± `jitterMs` (one-way, so RTT grows by twice that). WebSockets are TCP, so
 * messages keep their order — jitter shows up as bunching, never reordering.
 */
export class NetSim {
  latencyMs = 0
  jitterMs = 0
  private lastDelivery = { in: 0, out: 0 }

  get active(): boolean {
    return this.latencyMs > 0 || this.jitterMs > 0
  }

  delay(direction: 'in' | 'out', deliver: () => void): void {
    if (!this.active) {
      deliver()
      return
    }
    const now = performance.now()
    const at = Math.max(
      this.lastDelivery[direction],
      now + this.latencyMs + Math.random() * this.jitterMs,
    )
    this.lastDelivery[direction] = at
    setTimeout(deliver, at - now)
  }
}

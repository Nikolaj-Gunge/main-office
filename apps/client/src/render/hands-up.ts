import { HANDS_SECONDS } from '@office-fps/shared'
import * as THREE from 'three'

const SKIN = 0xc68e6a
const SLEEVE = 0x2e4057

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

/** One raised hand seen from behind: an open palm (four fingers, a thumb) on a sleeve. */
function raisedHand(side: -1 | 1): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.08, 0.32, 0.08, SLEEVE, 0, -0.2, 0)) // forearm, down out of view
  g.add(box(0.075, 0.08, 0.025, SKIN, 0, 0.0, 0)) // palm
  for (let i = 0; i < 4; i++) g.add(box(0.014, 0.05, 0.018, SKIN, -0.027 + i * 0.018, 0.065, 0))
  g.add(box(0.016, 0.04, 0.018, SKIN, -side * 0.048, 0.02, 0)) // thumb, towards the middle
  return g
}

/**
 * Your own hands up ("don't shoot") in first person: the gun drops out of view (Viewmodel's
 * `handsUp`) and two open hands come up into the top corners of the screen for HANDS_SECONDS.
 */
export class HandsUpView {
  readonly group = new THREE.Group()
  private readonly hands: THREE.Group[]
  private raisedAt = Number.NEGATIVE_INFINITY

  constructor() {
    this.hands = [raisedHand(-1), raisedHand(1)]
    for (const h of this.hands) h.scale.setScalar(0.75)
    this.group.add(...this.hands)
    this.group.visible = false
  }

  raise(nowMs: number): void {
    this.raisedAt = nowMs
  }

  /** Something else needs the hands (a shot): down at once. */
  drop(): void {
    this.raisedAt = Number.NEGATIVE_INFINITY
  }

  /** 0–1: how far up they are now. */
  level(nowMs: number): number {
    const t = (nowMs - this.raisedAt) / 1000
    if (t < 0 || t > HANDS_SECONDS) return 0
    return Math.min(1, t / 0.2, (HANDS_SECONDS - t) / 0.3)
  }

  /** Places the hands in view space (the viewmodel camera looks down -z). */
  update(nowMs: number): void {
    const up = this.level(nowMs)
    this.group.visible = up > 0
    if (!this.group.visible) return
    const e = up * up * (3 - 2 * up)
    const t = (nowMs - this.raisedAt) / 1000
    this.hands.forEach((h, i) => {
      const side = i === 0 ? -1 : 1
      // A small shake: hands up in front of a stranger with a gun is not a relaxed pose.
      const shake = Math.sin(t * 9 + i * 2) * 0.004
      h.position.set(side * 0.24, -0.36 + 0.4 * e + shake, -0.45)
      h.rotation.set(0.15, 0, -side * 0.18)
    })
  }
}

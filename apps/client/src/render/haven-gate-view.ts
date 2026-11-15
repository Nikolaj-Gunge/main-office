import {
  GATE_LIFT,
  gateOpen,
  HAVEN_CRANK,
  HAVEN_GATE,
  HAVEN_WALL,
  type SurvivalDef,
  type SurvivalShared,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'

/** How fast the gate goes up on its chain, and how fast it drops (m/s). */
const RISE = 1.6
const DROP = 7
/** Turns a second of the crank while somebody winds it. */
const SPIN = 1.4

/**
 * Haven's gate (haven-gate.ts): the map draws it shut; here it rises on its chain while it is
 * open (the server says when), drops with a bang, and the winch's crank turns while somebody
 * is on it, ratcheting as it goes.
 */
export class HavenGateView {
  readonly root = new THREE.Group()
  private readonly gate: THREE.Object3D | null
  private readonly crank = new THREE.Group()
  private readonly at: THREE.Vector3
  private readonly winch: THREE.Vector3
  private lift = 0
  private open = true
  private winding = 0
  private clickIn = 0
  private first = true

  constructor(
    def: SurvivalDef,
    mapObject: THREE.Object3D | null,
    private readonly audio: AudioEngine,
  ) {
    const h = def.pois.find((p) => p.key === 'haven')
    const hx = h?.x ?? 0
    const hy = h?.y ?? 0
    const hz = h?.z ?? 0
    this.gate = mapObject?.getObjectByName(`gate:${HAVEN_GATE}`) ?? null
    this.at = new THREE.Vector3(hx, hy + 1.5, hz - HAVEN_WALL)
    const [cx, cz] = HAVEN_CRANK
    this.winch = new THREE.Vector3(hx + cx, hy + 1, hz + cz)
    // The crank: an iron arm off the end of the drum, a wooden grip on the end (blocky).
    const iron = new THREE.MeshLambertMaterial({ color: 0x4a4440 })
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2c })
    const axle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), iron)
    axle.position.x = 0.08
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.07), iron)
    arm.position.set(0.18, 0.18, 0)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.09), wood)
    grip.position.set(0.3, 0.37, 0)
    this.crank.add(axle, arm, grip)
    for (const m of [axle, arm, grip]) m.castShadow = true
    this.crank.position.set(hx + cx + 0.42, hy + 0.92 + 0.15, hz + cz)
    this.root.add(this.crank)
  }

  /** What the server last said: is it up, and is somebody winding it? */
  apply(shared: SurvivalShared): void {
    this.open = gateOpen(shared.gates, HAVEN_GATE)
    this.winding = this.open ? 0 : (shared.crank ?? 0) / 100
    // Joining: it is where it is, no rising or slamming.
    if (this.first && this.gate) {
      this.first = false
      this.lift = this.open ? GATE_LIFT : 0
      this.gate.position.y = this.lift
    }
  }

  /** Every frame; true when it moved (the shadows want redrawing). */
  update(dt: number, eye: THREE.Vector3): boolean {
    if (!this.gate) return false
    const near = eye.distanceTo(this.at) < 150
    // Wound part way, it lifts a hand's breadth on the chain; open, all the way.
    const target = this.open ? GATE_LIFT : this.winding * 0.35
    const before = this.lift
    if (target > this.lift) this.lift = Math.min(target, this.lift + RISE * dt)
    else if (target < this.lift) {
      this.lift = Math.max(target, this.lift - DROP * dt)
      if (this.lift === 0 && before > 0.5 && near)
        this.audio.play('bang', { at: this.at, volume: 1, rate: 0.6 })
    }
    if (this.lift !== before) this.gate.position.y = this.lift
    // The crank turns while somebody winds it (or the gate goes up), ratcheting each half turn.
    const turning = this.winding > 0 || (this.open && this.lift < GATE_LIFT)
    if (turning) {
      this.crank.rotation.x -= SPIN * Math.PI * 2 * dt
      this.clickIn -= dt
      if (this.clickIn <= 0 && near) {
        this.clickIn = 0.32
        this.audio.play('bolt', { at: this.winch, volume: 0.5, rate: 0.55 })
      }
    }
    return this.lift !== before
  }
}

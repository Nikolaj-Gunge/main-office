import {
  ECHO_RATE,
  ECHO_REACH,
  type EchoReplay,
  echoPose,
  type StainShared,
} from '@office-fps/shared'
import * as THREE from 'three'

/** How long a played echo lingers before it fades, after its last frame (s). */
const LINGER = 1.2
/** Seconds the ghost takes to fade out. */
const FADE = 0.8
const GHOST_OPACITY = 0.22

/** A box mesh of the ghost: `w`×`h`×`d`, its top at `top` (so limbs swing from the joint). */
function part(mat: THREE.Material, w: number, h: number, d: number, top: number, x = 0) {
  const pivot = new THREE.Group()
  pivot.position.set(x, top, 0)
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.y = -h / 2
  pivot.add(m)
  return pivot
}

/**
 * Bloodstain echoes (shared/survival/echoes.ts) in the world: a faint dark stain where somebody
 * fell lately, and, when the server sends one (E on a stain or at a grave), a pale blocky ghost
 * walking their last seconds and fading where they fell. No sound.
 */
export class EchoesView {
  readonly root = new THREE.Group()
  private readonly stains = new Map<number, THREE.Mesh>()
  private readonly stainGeo = new THREE.BoxGeometry(1, 0.02, 0.7)
  private readonly stainMat = new THREE.MeshLambertMaterial({
    color: 0x2e0806,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  })
  private readonly ghostMat = new THREE.MeshBasicMaterial({
    color: 0x9eacb8,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
    fog: true,
  })
  private readonly ghost = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly legs: THREE.Group[]
  private readonly arms: THREE.Group[]
  private playing: { echo: EchoReplay; t: number } | null = null

  constructor() {
    this.root.name = 'echoes'
    const m = this.ghostMat
    const torso = part(m, 0.5, 0.62, 0.28, 1.42)
    const head = part(m, 0.3, 0.3, 0.3, 1.78)
    this.legs = [part(m, 0.2, 0.8, 0.22, 0.8, -0.13), part(m, 0.2, 0.8, 0.22, 0.8, 0.13)]
    this.arms = [part(m, 0.16, 0.62, 0.18, 1.4, -0.34), part(m, 0.16, 0.62, 0.18, 1.4, 0.34)]
    this.body.add(torso, head, ...this.legs, ...this.arms)
    this.ghost.add(this.body)
    this.ghost.visible = false
    this.root.add(this.ghost)
  }

  /** The stains as shared: added where new, taken away where gone. */
  apply(stains: readonly StainShared[] | undefined): void {
    const want = new Set((stains ?? []).map((s) => s.id))
    for (const [id, m] of this.stains) {
      if (want.has(id)) continue
      this.root.remove(m)
      this.stains.delete(id)
    }
    for (const s of stains ?? []) {
      if (this.stains.has(s.id)) continue
      const m = new THREE.Mesh(this.stainGeo, this.stainMat)
      m.position.set(s.x, s.y + 0.03, s.z)
      // A fixed turn per stain, so they don't all lie the same way.
      m.rotation.y = (s.id * 2.399) % Math.PI
      m.scale.setScalar(0.8 + ((s.id * 0.37) % 0.5))
      m.renderOrder = 1
      this.root.add(m)
      this.stains.set(s.id, m)
    }
  }

  /** A stain within reach of `pos` (for the E prompt). */
  near(pos: { x: number; z: number }): boolean {
    for (const m of this.stains.values())
      if (Math.hypot(m.position.x - pos.x, m.position.z - pos.z) < ECHO_REACH) return true
    return false
  }

  /** Plays an echo from its start. */
  play(echo: EchoReplay): void {
    if (echo.frames.length === 0) return
    this.playing = { echo, t: 0 }
    this.ghost.visible = true
    this.ghostMat.opacity = GHOST_OPACITY
  }

  update(dt: number): void {
    const p = this.playing
    if (!p) return
    p.t += dt
    const frames = p.echo.frames.length / 5
    const at = Math.min(p.t * ECHO_RATE, frames - 1)
    const i = Math.floor(at)
    const a = echoPose(p.echo, i)
    const b = echoPose(p.echo, Math.min(i + 1, frames - 1)) ?? a
    if (!a || !b) return void this.stop()
    const k = at - i
    this.ghost.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k)
    // The shortest way round between the two yaws.
    const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))
    this.ghost.rotation.y = a.yaw + dy * k
    // Legs and arms swing with how fast it moves; crouched, it sinks.
    const speed = Math.hypot(b.x - a.x, b.z - a.z) * ECHO_RATE
    const swing = Math.sin(p.t * 9) * Math.min(0.7, speed * 0.18)
    this.legs[0]?.rotation.set(swing, 0, 0)
    this.legs[1]?.rotation.set(-swing, 0, 0)
    this.arms[0]?.rotation.set(-swing * 0.8, 0, 0)
    this.arms[1]?.rotation.set(swing * 0.8, 0, 0)
    this.body.position.y = a.crouched ? -0.45 : 0
    const end = frames / ECHO_RATE + LINGER
    if (p.t > end) {
      // At the end it sinks into the ground and fades.
      const f = Math.min(1, (p.t - end) / FADE)
      this.ghostMat.opacity = GHOST_OPACITY * (1 - f)
      this.body.rotation.x = f * 1.2
      if (f >= 1) this.stop()
    } else this.body.rotation.x = 0
  }

  private stop(): void {
    this.playing = null
    this.ghost.visible = false
    this.body.rotation.x = 0
  }

  clear(): void {
    this.stop()
    this.apply([])
  }
}

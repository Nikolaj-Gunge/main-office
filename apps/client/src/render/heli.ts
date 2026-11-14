import {
  crateHeight,
  DROP_LAND,
  DROP_RELEASE,
  HELI_GONE,
  heliPos,
  type SupplyDrop,
} from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import { rumble } from '../game/game-feel.ts'

/** Smoke puffs per burning flare. */
const PUFFS = 26
/** The rotors are heard this far off (m). */
const HEARD = 1100
const SOUND_SPEED = 343

const now = () => performance.now() / 1000

let glowTexture: THREE.Texture | null = null
/** A soft round dot, for lights seen from far off and for smoke. */
function glow(): THREE.Texture {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const g = canvas.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.25, 'rgba(255,255,255,0.65)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  }
  glowTexture = new THREE.CanvasTexture(canvas)
  return glowTexture
}

/** A light seen through fog and dark: an additive dot, `size` of the screen or metres. */
function beacon(color: number, size: number, screen: boolean): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow(),
      color,
      fog: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: !screen,
    }),
  )
  sprite.scale.setScalar(size)
  return sprite
}

const box = (
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  return mesh
}

/** A military helicopter out of boxes: nose towards −z. */
function buildHeli(): {
  root: THREE.Group
  rotor: THREE.Group
  tail: THREE.Group
  blink: { sprite: THREE.Sprite; phase: number; on: number }[]
  searchlight: THREE.Object3D
} {
  const root = new THREE.Group()
  const olive = new THREE.MeshLambertMaterial({ color: 0x323a28 })
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1f17 })
  const glass = new THREE.MeshLambertMaterial({ color: 0x18222c, emissive: 0x0b2a1c })
  root.add(
    box(2.4, 2.3, 5.4, olive, 0, 0, 0),
    box(2.0, 1.5, 1.8, olive, 0, -0.3, -3.4),
    box(2.1, 0.9, 1.3, glass, 0, 0.45, -3.1),
    box(1.6, 0.8, 3.2, dark, 0, 1.5, 0.3),
    box(0.7, 0.7, 7.2, olive, 0, 0.55, 6.2),
    box(0.22, 2.2, 1.3, olive, 0, 1.6, 9.5),
    box(2.6, 0.1, 0.7, olive, 0, 0.6, 8.9),
    // Doors' dark windows down the sides.
    box(2.45, 0.7, 1.6, glass, 0, 0.35, -0.6),
  )
  // Skids.
  for (const side of [-1, 1]) {
    root.add(box(0.14, 0.14, 5.2, dark, side * 1.25, -1.75, -0.2))
    root.add(box(0.1, 0.65, 0.1, dark, side * 1.15, -1.4, -1.6))
    root.add(box(0.1, 0.65, 0.1, dark, side * 1.15, -1.4, 1.2))
  }
  const rotor = new THREE.Group()
  rotor.position.set(0, 2.05, 0.2)
  rotor.add(box(0.3, 0.3, 0.3, dark, 0, -0.1, 0))
  for (let i = 0; i < 4; i++) {
    const blade = box(0.35, 0.05, 8, dark, 0, 0, 4)
    const arm = new THREE.Group()
    arm.rotation.y = (i * Math.PI) / 2
    arm.add(blade)
    rotor.add(arm)
  }
  // The blur of the blades.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(8, 32),
    new THREE.MeshBasicMaterial({
      color: 0x101410,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  disc.rotation.x = -Math.PI / 2
  rotor.add(disc)
  root.add(rotor)
  const tail = new THREE.Group()
  tail.position.set(0.25, 1.7, 9.6)
  tail.add(box(0.05, 2.1, 0.22, dark, 0, 0, 0), box(0.05, 0.22, 2.1, dark, 0, 0, 0))
  root.add(tail)

  // Nav lights: red port, green starboard, a white tail light and a red beacon that flash.
  const blink: { sprite: THREE.Sprite; phase: number; on: number }[] = []
  const light = (color: number, x: number, y: number, z: number, phase: number, on: number) => {
    const sprite = beacon(color, 0.012, true)
    sprite.position.set(x, y, z)
    root.add(sprite)
    blink.push({ sprite, phase, on })
  }
  light(0xff2a20, -1.3, 0, -0.5, 0, 1)
  light(0x30ff60, 1.3, 0, -0.5, 0, 1)
  light(0xffffff, 0, 2.8, 10, 0.5, 0.08)
  light(0xff1a10, 0, -1.25, 0.4, 0, 0.12)
  light(0xff1a10, 0, 2.0, 1.8, 0.33, 0.12)

  const searchlight = new THREE.Object3D()
  searchlight.position.set(0, -1.3, -3.6)
  root.add(searchlight)
  root.add(box(0.4, 0.3, 0.4, dark, 0, -1.25, -3.6))
  return { root, rotor, tail, blink, searchlight }
}

/** A crate on a parachute (the chute packs away once it's down). */
function buildCrate(): { root: THREE.Group; chute: THREE.Group } {
  const root = new THREE.Group()
  const wood = new THREE.MeshLambertMaterial({ color: 0x4d5532 })
  const strap = new THREE.MeshLambertMaterial({ color: 0x1e2016 })
  // Self-lit just enough to be found next to its flare.
  const stencil = new THREE.MeshBasicMaterial({ color: 0x8a8f70 })
  root.add(box(1.2, 0.9, 1.2, wood, 0, 0.45, 0))
  root.add(box(1.24, 0.12, 1.24, strap, 0, 0.92, 0))
  root.add(box(0.16, 0.94, 1.24, strap, 0, 0.45, 0))
  root.add(box(1.24, 0.94, 0.16, strap, 0, 0.45, 0))
  root.add(box(0.5, 0.02, 0.3, stencil, 0.2, 0.99, 0.3))
  const chute = new THREE.Group()
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshLambertMaterial({ color: 0x5a6346, side: THREE.DoubleSide }),
  )
  canopy.scale.y = 0.6
  canopy.position.y = 4.6
  chute.add(canopy)
  const lines: number[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = 3.4 * Math.sin(Math.PI / 2.4)
    const top = 4.6 + 3.4 * Math.cos(Math.PI / 2.4) * 0.6
    lines.push(Math.cos(a) * r, top, Math.sin(a) * r, 0, 1, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
  chute.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8a8a78 })))
  root.add(chute)
  return { root, chute }
}

interface Puff {
  sprite: THREE.Sprite
  age: number
  life: number
  vx: number
  vz: number
}

interface Shown {
  drop: SupplyDrop
  /** Client time (s) the helicopter set out. */
  t0: number
  heli: ReturnType<typeof buildHeli>
  crate: ReturnType<typeof buildCrate>
  cone: THREE.Mesh
  flare: THREE.Group
  halo: THREE.Sprite
  core: THREE.Sprite
  puffs: Puff[]
  nextRotor: number
  rotorVariant: number
  landed: boolean
  /** Where the helicopter was last frame (for its speed: tilt and Doppler). */
  last: THREE.Vector3 | null
}

/**
 * Supply drops as everybody sees them: the helicopter coming in low with its searchlight
 * sweeping the trees, the crate on its parachute, and the red flare and its smoke where it lies
 * until somebody opens it. All of it flown from the replicated drop (SurvivalShared.drops), so
 * every client sees the same flight.
 */
export class HeliView {
  private readonly scene: THREE.Scene
  private readonly audio: AudioEngine
  /** Ground height at a point. */
  private readonly ground: (x: number, z: number) => number
  private readonly shown = new Map<number, Shown>()
  /** One searchlight and one flare light, lent to the nearest drop that wants them. */
  private readonly spot = new THREE.SpotLight(0xfff4dc, 0, 260, 0.13, 0.5, 1)
  private readonly flareLight = new THREE.PointLight(0xff2a14, 0, 34, 1.6)

  constructor(scene: THREE.Scene, audio: AudioEngine, ground: (x: number, z: number) => number) {
    this.scene = scene
    this.audio = audio
    this.ground = ground
    this.spot.castShadow = false
    scene.add(this.spot, this.spot.target, this.flareLight)
  }

  /** The drops the server says there are (once a second, and when one changes). */
  apply(drops: readonly SupplyDrop[] | undefined): void {
    const t = now()
    const keep = new Set<number>()
    for (const drop of drops ?? []) {
      keep.add(drop.id)
      const t0 = t - drop.age
      const s = this.shown.get(drop.id)
      if (s) {
        s.drop = drop
        // Only jump the clock for a real disagreement (not a late packet).
        if (Math.abs(s.t0 - t0) > 0.75) s.t0 = t0
        continue
      }
      this.shown.set(drop.id, this.create(drop, t0))
    }
    for (const [id, s] of this.shown) if (!keep.has(id)) this.remove(id, s)
  }

  clear(): void {
    for (const [id, s] of this.shown) this.remove(id, s)
  }

  update(dt: number, eye: THREE.Vector3): void {
    const t = now()
    let spotFor: Shown | null = null
    let flareFor: Shown | null = null
    let flareD = Number.POSITIVE_INFINITY
    for (const s of this.shown.values()) {
      const age = t - s.t0
      this.flyHeli(s, age, eye, dt)
      if (age < HELI_GONE && age > 0) spotFor ??= s
      this.dropCrate(s, age)
      const burning = s.drop.landed && !s.drop.opened && age >= DROP_LAND
      s.flare.visible = burning
      if (burning) {
        this.burn(s, dt, t)
        const d = Math.hypot(s.drop.x - eye.x, s.drop.z - eye.z)
        if (d < flareD) {
          flareD = d
          flareFor = s
        }
      }
    }

    // The searchlight sweeps the ground ahead of and around the drop point.
    if (spotFor) {
      const h = spotFor.heli.searchlight.getWorldPosition(new THREE.Vector3())
      const age = t - spotFor.t0
      const d = spotFor.drop
      const sweep = Math.sin(age * 0.9) * 22
      const ahead = Math.max(-40, Math.min(25, (DROP_RELEASE - age) * 6))
      const tx = d.x - Math.cos(d.heading) * ahead - Math.sin(d.heading) * sweep
      const tz = d.z - Math.sin(d.heading) * ahead + Math.cos(d.heading) * sweep
      this.spot.position.copy(h)
      this.spot.target.position.set(tx, d.y, tz)
      this.spot.target.updateMatrixWorld()
      const fade = Math.min(1, age / 2, (HELI_GONE - age) / 3)
      this.spot.intensity = 2600 * Math.max(0, fade)
      this.aimCone(spotFor.cone, h, this.spot.target.position, fade)
    } else this.spot.intensity = 0

    if (flareFor) {
      const f = flareFor.flare.position
      this.flareLight.position.set(f.x, f.y + 0.4, f.z)
      this.flareLight.intensity = 26 * (0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 17.3))
    } else this.flareLight.intensity = 0
  }

  private create(drop: SupplyDrop, t0: number): Shown {
    const heli = buildHeli()
    const crate = buildCrate()
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff1d0,
        transparent: true,
        opacity: 0.025,
        fog: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // Front faces only: from inside the beam it must not become a wall of light.
        side: THREE.FrontSide,
      }),
    )
    cone.visible = false
    const flare = new THREE.Group()
    const fx = drop.x + Math.cos(drop.heading + 2.3) * 1.7
    const fz = drop.z + Math.sin(drop.heading + 2.3) * 1.7
    flare.position.set(fx, this.ground(fx, fz) + 0.04, fz)
    flare.add(box(0.06, 0.22, 0.06, new THREE.MeshBasicMaterial({ color: 0xffb0a0 }), 0, 0.1, 0))
    const halo = beacon(0xff3018, 3.2, false)
    halo.position.y = 0.3
    const core = beacon(0xff5030, 0.016, true)
    core.position.y = 0.3
    flare.add(halo, core)
    flare.visible = false
    const puffs: Puff[] = []
    for (let i = 0; i < PUFFS; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow(),
          color: 0xb03028,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
        }),
      )
      flare.add(sprite)
      // Staggered, so the column is there from the start.
      puffs.push({ sprite, age: (i / PUFFS) * 9, life: 9, vx: 0, vz: 0 })
    }
    heli.root.visible = false
    crate.root.visible = false
    this.scene.add(heli.root, crate.root, cone, flare)
    return {
      drop,
      t0,
      heli,
      crate,
      cone,
      flare,
      halo,
      core,
      puffs,
      nextRotor: 0,
      rotorVariant: 0,
      landed: drop.landed,
      last: null,
    }
  }

  private remove(id: number, s: Shown): void {
    this.shown.delete(id)
    for (const o of [s.heli.root, s.crate.root, s.cone, s.flare]) {
      this.scene.remove(o)
      o.traverse((c) => {
        if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) {
          c.geometry.dispose()
          const m = c.material as THREE.Material | THREE.Material[]
          for (const mm of Array.isArray(m) ? m : [m]) mm.dispose()
        } else if (c instanceof THREE.Sprite) c.material.dispose()
      })
    }
  }

  private flyHeli(s: Shown, age: number, eye: THREE.Vector3, dt: number): void {
    const flying = age > 0 && age < HELI_GONE
    s.heli.root.visible = flying
    s.cone.visible = flying
    if (!flying) {
      s.last = null
      return
    }
    const p = heliPos(s.drop, age)
    const root = s.heli.root
    root.position.set(p.x, p.y, p.z)
    const h = s.drop.heading
    // Nose along the flight; down when fast, up as it flares over the drop.
    const speed = s.last ? s.last.distanceTo(root.position) / Math.max(dt, 1e-3) : 40
    const brake = age < DROP_RELEASE ? Math.max(0, 1 - (DROP_RELEASE - age) / 5) : 0
    root.rotation.set(0, 0, 0)
    root.rotation.order = 'YXZ'
    root.rotation.y = Math.atan2(-Math.cos(h), -Math.sin(h))
    root.rotation.x = -Math.min(0.2, speed / 260) + brake * 0.22
    root.rotation.z = Math.sin(age * 0.7) * 0.03
    s.heli.rotor.rotation.y += dt * 28
    s.heli.tail.rotation.x += dt * 45
    const t = now()
    for (const b of s.heli.blink) {
      const lit = ((t + b.phase) % 1.1) / 1.1 < b.on
      b.sprite.visible = lit
    }

    // The rotors: a second of thwop-thwop at a time, back to back, Doppler-shifted.
    if (t >= s.nextRotor - 0.1) {
      const d = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z)
      let rate = 1
      if (s.last) {
        const before = Math.hypot(s.last.x - eye.x, s.last.y - eye.y, s.last.z - eye.z)
        const closing = (before - d) / Math.max(dt, 1e-3)
        rate = Math.max(0.85, Math.min(1.15, SOUND_SPEED / (SOUND_SPEED - closing)))
      }
      const loud = Math.max(0, 1 - d / HEARD) ** 1.6
      const fade = Math.min(1, age / 4, (HELI_GONE - age) / 4)
      if (loud * fade > 0.005) {
        this.audio.play('heli', {
          at: p,
          volume: 0.9 * loud * fade,
          lowpass: Math.max(500, 9000 * Math.exp(-d / 220)),
          rate,
          variant: s.rotorVariant,
          delay: Math.max(0, s.nextRotor - t),
        })
      }
      // Low overhead, every thwop rattles the view a little.
      rumble(p, 0.18 * fade, 70)
      s.rotorVariant = 1 - s.rotorVariant
      // Keep the beat (unless the tab was asleep: then start afresh).
      s.nextRotor = (Math.abs(t - s.nextRotor) < 0.5 ? s.nextRotor : t) + 1 / rate
    }
    s.last = (s.last ?? new THREE.Vector3()).copy(root.position)
  }

  private dropCrate(s: Shown, age: number): void {
    const d = s.drop
    const falling = age >= DROP_RELEASE
    s.crate.root.visible = falling
    if (!falling) return
    const k = Math.min(1, (age - DROP_RELEASE) / (DROP_LAND - DROP_RELEASE))
    const down = age >= DROP_LAND
    const root = s.crate.root
    root.position.set(d.x, d.y + crateHeight(age), d.z)
    root.rotation.set(0, d.heading, 0)
    if (!down) {
      // Swinging under the chute; the chute opens out after the first drop.
      root.rotation.z = Math.sin(age * 1.7) * 0.12
      root.rotation.x = Math.sin(age * 1.3 + 1) * 0.08
      s.crate.chute.visible = true
      s.crate.chute.scale.setScalar(Math.min(1, 0.25 + k * 6))
      s.crate.chute.position.set(0, 0, 0)
      s.crate.chute.rotation.set(0, 0, 0)
    } else {
      // Down: the chute settles over the ground beside it.
      const since = Math.min(1, (age - DROP_LAND) / 2.5)
      s.crate.chute.rotation.set(0, 0, (Math.PI / 2.1) * since)
      s.crate.chute.position.set(-4.6 * since, 0.2 * since, 0)
      s.crate.chute.scale.set(1, 1 - 0.85 * since, 1)
    }
    if (down && !s.landed) {
      s.landed = true
      this.audio.playNear('bang', { x: d.x, y: d.y + 0.5, z: d.z }, 1, 140, 8, 0.7)
      rumble(d, 0.6, 40)
    }
    if (!down) s.landed = false
  }

  /** The flare: flickering glow and a column of red smoke drifting off on the wind. */
  private burn(s: Shown, dt: number, t: number): void {
    const flicker = 0.8 + 0.2 * Math.sin(t * 27) * Math.sin(t * 13.1)
    s.halo.material.opacity = 0.9 * flicker
    s.halo.scale.setScalar(3.2 * (0.9 + 0.2 * flicker))
    for (const p of s.puffs) {
      p.age += dt
      if (p.age >= p.life) {
        p.age -= p.life
        p.vx = 0.25 + (Math.random() - 0.5) * 0.3
        p.vz = (Math.random() - 0.5) * 0.4
      }
      const k = p.age / p.life
      p.sprite.position.set(p.vx * p.age * 2, 0.4 + p.age * 2.6, p.vz * p.age * 2)
      p.sprite.scale.setScalar(0.6 + k * 5)
      // Lit red near the flare, grey and fading above.
      const m = p.sprite.material
      m.color.setRGB(0.75 - 0.45 * k, 0.2 + 0.1 * k, 0.17 + 0.13 * k)
      m.opacity = Math.min(1, k * 8) * (1 - k) * 0.55
    }
  }

  /** Stretches the searchlight's visible beam from the lamp to where it points. */
  private aimCone(cone: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, fade: number): void {
    const dir = new THREE.Vector3().subVectors(to, from)
    const length = dir.length()
    cone.position.copy(from).addScaledVector(dir, 0.5)
    // ConeGeometry points along +y with its tip up: tip at the lamp, mouth on the ground.
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize())
    const radius = Math.tan(0.13) * length
    cone.scale.set(radius, length, radius)
    ;(cone.material as THREE.MeshBasicMaterial).opacity = 0.025 * Math.max(0, fade)
  }
}

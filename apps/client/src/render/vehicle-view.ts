import { seeded } from '@office-fps/shared'
import * as THREE from 'three'

/** Paint, by a car's look: tired, muted colours (the cars of a county that ended a while ago). */
const PAINTS = [0x5a3832, 0x3a4854, 0x5b5a4e, 0x9c998e, 0x3b4134, 0x6e5d3a, 0x47474b]
const CHARRED = 0x1c1a18
/** Run down: rust, primer, mud, the dark inside where a window was. */
const RUST = [0x8a4824, 0x9a5328, 0x7a3f20]
const PRIMER = 0x8a877e
const MUD = 0x473a2b
const HOLE = 0x0b0c0d
const CRACK = 0xa9b2b4
/** Headlamps: a warm white, never a blue or a vivid yellow. */
export const HEADLAMP = 0xffe6c4

/** What a car looks like at one moment (interpolated or predicted). */
export interface CarPose {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  steer: number
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
  mesh.castShadow = true
  return mesh
}

let puffTexture: THREE.Texture | null = null
/** A flat box lying on a car's surface: no shadow of its own (it's paint, rust, mud). */
const skin = (
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh => {
  const mesh = box(w, h, d, material, x, y, z)
  mesh.castShadow = false
  return mesh
}

/** A soft round dot, for smoke. */
function puff(): THREE.Texture {
  if (puffTexture) return puffTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const g = canvas.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 32, 32)
  }
  puffTexture = new THREE.CanvasTexture(canvas)
  return puffTexture
}

const PUFFS = 10

/**
 * One car out of boxes, nose towards −z: a body, a glass cabin under a roof, bumpers, lamps and
 * four chunky wheels (the front pair steers). Every third look is a pickup with an open bed.
 * Smokes from under the bonnet when it's been knocked about; burnt black when wrecked.
 */
export class CarView {
  readonly root = new THREE.Group()
  /** Where the headlamps' light comes from and points (car space), for the light pool. */
  static readonly LAMP = new THREE.Vector3(0, 0.8, -2.3)
  private readonly tilt = new THREE.Group()
  private readonly paint: THREE.MeshLambertMaterial
  private readonly glass: THREE.MeshLambertMaterial
  private readonly lamps: THREE.MeshLambertMaterial
  private readonly tails: THREE.MeshLambertMaterial
  private readonly wheels: THREE.Object3D[] = []
  private readonly steering: THREE.Group[] = []
  private readonly mounts: THREE.Group[] = []
  /** Which wheel is the flat one, when it has a flat. */
  private readonly flatWheel: number
  private readonly smoke: { sprite: THREE.Sprite; age: number; life: number }[] = []
  private readonly paintColor: THREE.Color
  private spin = 0
  private smokeClock = 0

  constructor(look: number) {
    this.paintColor = new THREE.Color(PAINTS[look % PAINTS.length] ?? PAINTS[0])
    this.paint = new THREE.MeshLambertMaterial({ color: this.paintColor })
    this.glass = new THREE.MeshLambertMaterial({ color: 0x1a232b, emissive: 0x05080a })
    const dark = new THREE.MeshLambertMaterial({ color: 0x1e1e1e })
    this.lamps = new THREE.MeshLambertMaterial({ color: 0xd8d2c4, emissive: 0x000000 })
    this.tails = new THREE.MeshLambertMaterial({ color: 0x5a1712, emissive: 0x000000 })
    const t = this.tilt
    const pickup = look % 3 === 2
    // Every car was left differently: the same car (look) always the same way.
    const random = seeded(look * 7919 + 101)
    this.flatWheel = Math.floor(random() * 4)
    // The body: sills to the waist, the length of the car.
    t.add(box(1.9, 0.62, 4.4, this.paint, 0, 0.62, 0))
    if (pickup) {
      // The cab up front, the bed behind it: low sides and a tailgate.
      t.add(box(1.76, 0.62, 1.5, this.glass, 0, 1.24, -0.35))
      t.add(box(1.8, 0.08, 1.56, this.paint, 0, 1.58, -0.35))
      for (const side of [-1, 1]) t.add(box(0.08, 0.32, 2.1, this.paint, side * 0.91, 1.09, 1.12))
      t.add(box(1.9, 0.32, 0.08, this.paint, 0, 1.09, 2.17))
    } else {
      // A saloon: the glasshouse set back a little, a flat roof on it.
      t.add(box(1.72, 0.5, 2.2, this.glass, 0, 1.18, 0.2))
      t.add(box(1.76, 0.08, 2.0, this.paint, 0, 1.47, 0.25))
    }
    // Bumpers, a grille, the lamps.
    t.add(box(1.96, 0.18, 0.14, dark, 0, 0.38, -2.22), box(1.96, 0.18, 0.14, dark, 0, 0.38, 2.22))
    t.add(box(0.9, 0.18, 0.04, dark, 0, 0.72, -2.21))
    for (const side of [-1, 1]) {
      t.add(box(0.34, 0.15, 0.05, this.lamps, side * 0.66, 0.76, -2.21))
      t.add(box(0.3, 0.14, 0.05, this.tails, side * 0.68, 0.76, 2.21))
    }
    // Wheels: short eight-sided drums (blocky, like everything else).
    const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 8)
    tyre.rotateZ(Math.PI / 2)
    const hub = new THREE.BoxGeometry(0.27, 0.16, 0.16)
    const rubber = new THREE.MeshLambertMaterial({ color: 0x161616 })
    const steel = new THREE.MeshLambertMaterial({ color: 0x6d6d6a })
    const bare = new THREE.MeshLambertMaterial({ color: 0x3a2e26 })
    for (const [x, z] of [
      [-0.86, -1.4],
      [0.86, -1.4],
      [-0.86, 1.4],
      [0.86, 1.4],
    ] as const) {
      const mount = new THREE.Group()
      mount.position.set(x, 0.34, z)
      const wheel = new THREE.Group()
      const drum = new THREE.Mesh(tyre, rubber)
      drum.castShadow = true
      // Some hubcaps are long gone: a rusty bare hub.
      wheel.add(drum, new THREE.Mesh(hub, random() < 0.45 ? bare : steel))
      mount.add(wheel)
      t.add(mount)
      this.wheels.push(wheel)
      this.mounts.push(mount)
      if (z < 0) this.steering.push(mount)
    }
    this.runDown(random, pickup)
    this.root.add(t)
    for (let i = 0; i < PUFFS; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: puff(),
          color: 0x6a6a6a,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      )
      sprite.visible = false
      this.root.add(sprite)
      this.smoke.push({ sprite, age: 0, life: 1 })
    }
  }

  /**
   * Years by the road, out of boxes: rust patches, a door or bonnet off another car, dents,
   * cracked or missing windows, mud up the sills. Seeded, so each car always looks the same.
   */
  private runDown(random: () => number, pickup: boolean): void {
    const t = this.tilt
    const lambert = (color: number) => new THREE.MeshLambertMaterial({ color })
    const side = () => (random() < 0.5 ? -1 : 1)
    const rust = lambert(RUST[Math.floor(random() * RUST.length)] ?? 0x6b3a1e)
    const dent = lambert(this.paintColor.clone().multiplyScalar(0.62).getHex())
    // A panel off another car, or bare primer.
    const other = lambert(
      random() < 0.5 ? PRIMER : (PAINTS[Math.floor(random() * PAINTS.length)] ?? PRIMER),
    )
    // Rust: on the flanks, the bonnet, the roof.
    for (let i = 2 + Math.floor(random() * 4); i > 0; i--) {
      const where = random()
      if (where < 0.6) {
        const h = 0.1 + random() * 0.24
        const y = 0.34 + h / 2 + random() * (0.54 - h)
        t.add(skin(0.02, h, 0.2 + random() * 0.6, rust, side() * 0.956, y, (random() - 0.5) * 3.8))
      } else if (where < 0.85 || pickup) {
        const z = -1.35 - random() * 0.6
        t.add(
          skin(
            0.25 + random() * 0.6,
            0.02,
            0.2 + random() * 0.4,
            rust,
            (random() - 0.5) * 1.1,
            0.935,
            z,
          ),
        )
      } else {
        t.add(
          skin(
            0.3 + random() * 0.6,
            0.02,
            0.3 + random() * 0.6,
            rust,
            (random() - 0.5) * 0.9,
            1.515,
            0.25 + (random() - 0.5) * 1.2,
          ),
        )
      }
    }
    // A door from the scrapyard.
    if (random() < 0.55) {
      const z = pickup || random() < 0.5 ? -0.45 : 0.62
      t.add(skin(0.02, 0.56, 0.98, other, side() * 0.958, 0.64, z))
    }
    // Or a bonnet.
    if (random() < 0.25) t.add(skin(1.82, 0.02, 1.15, other, 0, 0.94, -1.6))
    // Dents: dark creases in a flank, and now and then a crumpled corner.
    for (let i = 1 + Math.floor(random() * 2); i > 0; i--) {
      const z = (random() - 0.5) * 3.6
      t.add(
        skin(
          0.02,
          0.1 + random() * 0.12,
          0.3 + random() * 0.4,
          dent,
          side() * 0.955,
          0.5 + random() * 0.3,
          z,
        ),
      )
    }
    if (random() < 0.4) {
      const corner = box(
        0.5,
        0.34,
        0.34,
        dent,
        side() * 0.74,
        0.62,
        (random() < 0.5 ? -1 : 1) * 2.08,
      )
      corner.rotation.set((random() - 0.5) * 0.3, (random() - 0.5) * 0.5, (random() - 0.5) * 0.3)
      t.add(corner)
    }
    // Windows: a cracked windscreen, a side window gone (the dark inside shows), the back one.
    const glass = pickup
      ? { front: -1.1, back: 0.4, x: 0.88, y: 1.24, h: 0.62 }
      : { front: -0.9, back: 1.3, x: 0.86, y: 1.18, h: 0.5 }
    if (random() < 0.5) {
      const crack = lambert(CRACK)
      const cx = (random() - 0.5) * 0.9
      const cy = glass.y + (random() - 0.5) * glass.h * 0.4
      for (let i = 0; i < 4; i++) {
        const line = skin(0.3 + random() * 0.4, 0.018, 0.012, crack, cx, cy, glass.front - 0.008)
        line.rotation.z = (i / 4) * Math.PI + random() * 0.5
        t.add(line)
      }
    }
    const hole = lambert(HOLE)
    if (random() < 0.45) {
      const length = glass.back - glass.front
      const z = pickup
        ? glass.front + length / 2
        : glass.front + length * (random() < 0.5 ? 0.27 : 0.73)
      t.add(
        skin(
          0.012,
          glass.h * 0.74,
          length * (pickup ? 0.6 : 0.4),
          hole,
          side() * (glass.x + 0.006),
          glass.y + 0.02,
          z,
        ),
      )
    }
    if (!pickup && random() < 0.3)
      t.add(skin(1.4, 0.36, 0.012, hole, 0, glass.y + 0.02, glass.back + 0.008))
    // Mud: up the sills, more behind the wheels.
    const mud = lambert(MUD)
    const height = 0.08 + random() * 0.16
    for (const sx of [-1, 1]) {
      t.add(skin(0.02, height, 4.3, mud, sx * 0.957, 0.31 + height / 2, 0))
      for (const z of [-1.4, 1.4]) t.add(skin(0.02, 0.18, 0.5, mud, sx * 0.958, 0.66, z + 0.45))
    }
  }

  /**
   * Places the car and animates it: `speed` turns the wheels (m/s, forward +), `running` lights
   * the lamps, `health` (0–100) decides how much it smokes; `sputter`: the engine is dying (it
   * steams), `flat`: one tyre is flat (that corner sits low).
   */
  update(
    dt: number,
    pose: CarPose,
    speed: number,
    running: boolean,
    night: number,
    health: number,
    wrecked: boolean,
    trouble: { sputter: boolean; flat: boolean } = { sputter: false, flat: false },
  ): void {
    this.root.position.set(pose.x, pose.y, pose.z)
    this.root.rotation.set(0, pose.yaw, 0)
    this.tilt.rotation.set(pose.pitch, 0, pose.roll, 'XYZ')
    this.spin -= (speed * dt) / 0.34
    for (const w of this.wheels) w.rotation.x = this.spin
    for (const s of this.steering) s.rotation.y = pose.steer * 0.5
    this.mounts.forEach((m, i) => {
      const flat = trouble.flat && i === this.flatWheel
      m.scale.y = flat ? 0.62 : 1
      m.position.y = flat ? 0.22 : 0.34
    })
    // Sitting on the flat: that corner low.
    const sag = trouble.flat ? 0.04 : 0
    const sx = this.flatWheel % 2 === 0 ? -1 : 1
    const sz = this.flatWheel < 2 ? 1 : -1
    this.tilt.rotation.set(pose.pitch + sag * sz, 0, pose.roll + sag * sx, 'XYZ')
    const lit = running && !wrecked
    this.lamps.emissive.setHex(lit ? HEADLAMP : 0x000000)
    this.lamps.emissiveIntensity = 0.4 + night * 1.2
    this.tails.emissive.setHex(lit ? 0x40100b : 0x000000)
    this.paint.color.copy(this.paintColor).lerp(new THREE.Color(CHARRED), wrecked ? 0.85 : 0)
    const hurt = wrecked ? 1 : Math.max(0, (55 - health) / 55)
    this.smokeFrom(dt, Math.max(hurt, trouble.sputter ? 0.45 : 0))
  }

  /** Smoke from the bonnet, thicker and darker the worse it is (0 = none, 1 = a wreck). */
  private smokeFrom(dt: number, amount: number): void {
    this.smokeClock += dt * amount * 9
    for (const p of this.smoke) {
      if (!p.sprite.visible && this.smokeClock >= 1) {
        this.smokeClock -= 1
        p.sprite.visible = true
        p.age = 0
        p.life = 1.4 + Math.random() * 1.2
        p.sprite.position.set((Math.random() - 0.5) * 0.6, 1.0, -1.5 + Math.random() * 0.4)
        ;(p.sprite.material as THREE.SpriteMaterial).color.setScalar(0.45 - amount * 0.32)
      }
      if (!p.sprite.visible) continue
      p.age += dt
      const k = p.age / p.life
      if (k >= 1) {
        p.sprite.visible = false
        continue
      }
      p.sprite.position.y += dt * (0.9 + amount * 0.6)
      p.sprite.position.x += dt * 0.25
      p.sprite.scale.setScalar(0.5 + k * (1.6 + amount * 1.4))
      ;(p.sprite.material as THREE.SpriteMaterial).opacity = (1 - k) * (0.35 + amount * 0.4)
    }
    this.smokeClock = Math.min(this.smokeClock, 2)
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  }
}

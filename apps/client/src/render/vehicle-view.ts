import * as THREE from 'three'

/** Paint, by a car's look: tired, muted colours (the cars of a county that ended a while ago). */
const PAINTS = [0x5a3832, 0x3a4854, 0x5b5a4e, 0x9c998e, 0x3b4134, 0x6e5d3a, 0x47474b]
const CHARRED = 0x1c1a18
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
      wheel.add(drum, new THREE.Mesh(hub, steel))
      mount.add(wheel)
      t.add(mount)
      this.wheels.push(wheel)
      if (z < 0) this.steering.push(mount)
    }
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
   * Places the car and animates it: `speed` turns the wheels (m/s, forward +), `running` lights
   * the lamps, `health` (0–100) decides how much it smokes.
   */
  update(
    dt: number,
    pose: CarPose,
    speed: number,
    running: boolean,
    night: number,
    health: number,
    wrecked: boolean,
  ): void {
    this.root.position.set(pose.x, pose.y, pose.z)
    this.root.rotation.set(0, pose.yaw, 0)
    this.tilt.rotation.set(pose.pitch, 0, pose.roll, 'XYZ')
    this.spin -= (speed * dt) / 0.34
    for (const w of this.wheels) w.rotation.x = this.spin
    for (const s of this.steering) s.rotation.y = pose.steer * 0.5
    const lit = running && !wrecked
    this.lamps.emissive.setHex(lit ? HEADLAMP : 0x000000)
    this.lamps.emissiveIntensity = 0.4 + night * 1.2
    this.tails.emissive.setHex(lit ? 0x40100b : 0x000000)
    this.paint.color.copy(this.paintColor).lerp(new THREE.Color(CHARRED), wrecked ? 0.85 : 0)
    this.smokeFrom(dt, wrecked ? 1 : Math.max(0, (55 - health) / 55))
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

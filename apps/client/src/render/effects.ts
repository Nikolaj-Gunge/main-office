import * as THREE from 'three'

const TRACER_SPEED = 300 // m/s — far slower than a real bullet, so you can see it travel
const TRACER_LENGTH = 3
/** Hard cap on how long a tracer can exist (s), whatever happens. */
const TRACER_MAX_AGE = 2
const MAX_BLOOD = 48
const MAX_SMOKE = 96
/** Blood marks stay this long (s), fading out over the last few seconds. */
const BLOOD_LIFE = 20
const BLOOD_FADE = 4
const MAX_DECALS = 128
const MAX_PARTICLES = 160
const MAX_CASINGS = 24
const CASING_LIFE = 2.5
const GRAVITY = 9.8

/** Segment raycast against the level: distance along `dir` and the surface normal, or null. */
export type WorldRaycast = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDistance: number,
) => { distance: number; normal: THREE.Vector3 } | null

interface Casing {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  spin: THREE.Vector3
  life: number
  bounced: boolean
}

interface Tracer {
  mesh: THREE.Mesh
  from: THREE.Vector3
  dir: THREE.Vector3
  distance: number
  traveled: number
  age: number
}

interface SmokePuff {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  vel: THREE.Vector3
  life: number
  maxLife: number
  startSize: number
  endSize: number
  opacity: number
}

interface BloodMark {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  maxLife: number
}

const PLANE_NORMAL = new THREE.Vector3(0, 0, 1)
const spin = new THREE.Quaternion()

/**
 * Lays a pooled plane flat on a surface: facing along `normal`, lifted `lift` m off it, turned
 * randomly about the normal. (Not Object3D.lookAt — with matrixAutoUpdate off it aims from the
 * mesh's *previous* world position, which tilted every decal the wrong way.)
 */
function placeFlat(
  mesh: THREE.Mesh,
  at: THREE.Vector3,
  normal: THREE.Vector3,
  lift: number,
  size: number,
): void {
  const n = normal.clone().normalize()
  mesh.position.copy(at).addScaledVector(n, lift)
  mesh.quaternion.setFromUnitVectors(PLANE_NORMAL, n)
  mesh.quaternion.multiply(spin.setFromAxisAngle(PLANE_NORMAL, Math.random() * Math.PI * 2))
  mesh.scale.setScalar(size)
  mesh.updateMatrix()
}

/** Soft, dithered puff: dense in the middle, broken up towards the edge (reads as pixel smoke). */
function makeSmokeTexture(): THREE.CanvasTexture {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  let seed = 4242
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)
      const density = Math.max(0, 1 - d) ** 1.1
      if (rand() < density * 2.5) {
        const shade = 215 + Math.floor(rand() * 35)
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${Math.min(1, density * 2.4)})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  return tex
}

/** Irregular dark-red splat with droplets, transparent around it. */
function makeBloodTexture(): THREE.CanvasTexture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  let seed = 99
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const blob = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) ctx.fillRect(x + dx, y + dy, 1, 1)
      }
    }
  }
  blob(16, 16, 7, '#6e0d0d')
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const d = 5 + rand() * 6
    blob(
      Math.round(16 + Math.cos(a) * d),
      Math.round(16 + Math.sin(a) * d),
      2 + Math.floor(rand() * 3),
      '#7d1010',
    )
  }
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2
    const d = 10 + rand() * 5
    ctx.fillStyle = '#8a1414'
    ctx.fillRect(Math.round(16 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d), 1, 1)
  }
  blob(15, 15, 3, '#9c1a1a')
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeHoleTexture(): THREE.CanvasTexture {
  const size = 8
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.fillStyle = 'rgba(30,26,22,0.85)'
  ctx.fillRect(2, 2, 4, 4)
  ctx.fillRect(3, 1, 2, 6)
  ctx.fillRect(1, 3, 6, 2)
  ctx.fillStyle = 'rgba(10,8,6,1)'
  ctx.fillRect(3, 3, 2, 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Pooled shot effects in the world: tracers that visibly travel, bullet holes, impact puffs
 * (dust for walls, red for players) and short muzzle-flash lights. Decals, particles and lights
 * are pooled; tracers are short-lived meshes sharing one geometry and material.
 */
export class Effects {
  private readonly tracers: Tracer[] = []
  private readonly decals: THREE.Mesh[] = []
  private decalIndex = 0
  private readonly particles: Particle[] = []
  private particleIndex = 0
  private readonly lights: { light: THREE.PointLight; life: number }[] = []
  private lightIndex = 0
  private readonly smoke: SmokePuff[] = []
  private smokeIndex = 0
  private readonly blood: BloodMark[] = []
  private bloodIndex = 0
  private readonly casings: Casing[] = []
  private casingIndex = 0
  private readonly raycast: WorldRaycast
  /** Called the first time a casing hits something (for the clink sound). */
  onCasingHit?: (at: THREE.Vector3) => void

  private readonly tracerGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5)
  private readonly tracerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe8a0,
    transparent: true,
    opacity: 0.9,
    fog: false,
  })
  private readonly heavyTracerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    fog: false,
  })
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene, raycast: WorldRaycast) {
    this.scene = scene
    this.raycast = raycast

    const holeGeometry = new THREE.PlaneGeometry(0.09, 0.09)
    const holeMaterial = new THREE.MeshBasicMaterial({
      map: makeHoleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })
    for (let i = 0; i < MAX_DECALS; i++) {
      const decal = new THREE.Mesh(holeGeometry, holeMaterial)
      decal.visible = false
      decal.matrixAutoUpdate = false
      scene.add(decal)
      this.decals.push(decal)
    }

    const particleGeometry = new THREE.BoxGeometry(0.035, 0.035, 0.035)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mesh = new THREE.Mesh(
        particleGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      )
      mesh.visible = false
      scene.add(mesh)
      this.particles.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1 })
    }

    const smokeTexture = makeSmokeTexture()
    for (let i = 0; i < MAX_SMOKE; i++) {
      const material = new THREE.SpriteMaterial({
        map: smokeTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
      const sprite = new THREE.Sprite(material)
      sprite.visible = false
      sprite.renderOrder = 2
      scene.add(sprite)
      this.smoke.push({
        sprite,
        material,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        startSize: 0.1,
        endSize: 0.5,
        opacity: 0.3,
      })
    }

    const bloodTexture = makeBloodTexture()
    const bloodGeometry = new THREE.PlaneGeometry(1, 1)
    for (let i = 0; i < MAX_BLOOD; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: bloodTexture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
      })
      const mesh = new THREE.Mesh(bloodGeometry, material)
      mesh.visible = false
      mesh.matrixAutoUpdate = false
      scene.add(mesh)
      this.blood.push({ mesh, material, life: 0 })
    }

    const casingGeometry = new THREE.BoxGeometry(0.012, 0.012, 0.03)
    const brass = new THREE.MeshLambertMaterial({ color: 0xd9a441, emissive: 0x3a2a08 })
    for (let i = 0; i < MAX_CASINGS; i++) {
      const mesh = new THREE.Mesh(casingGeometry, brass)
      mesh.visible = false
      scene.add(mesh)
      this.casings.push({
        mesh,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        bounced: false,
      })
    }

    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 12, 2)
      scene.add(light)
      this.lights.push({ light, life: 0 })
    }
  }

  /**
   * A bullet from `from` to `to`; `hit` decides the impact effect at the end. `own` = your own
   * gun: its smoke is fainter and starts a bit ahead so it never clouds your aim.
   */
  shot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    normal: THREE.Vector3,
    hit: 'world' | 'player' | 'nothing',
    heavy = false,
    own = false,
    /** False for a shotgun's extra pellets: one flash and one smoke cloud per shot. */
    muzzleEffects = true,
  ): void {
    if (muzzleEffects) {
      this.flashLight(from)
      this.muzzleSmoke(from, to.clone().sub(from).normalize(), heavy, own)
    }
    const dir = to.clone().sub(from)
    const distance = dir.length()
    if (distance > 0.5) {
      // Sniper rounds leave a thicker, whiter streak.
      const mesh = new THREE.Mesh(
        this.tracerGeometry,
        heavy ? this.heavyTracerMaterial : this.tracerMaterial,
      )
      const width = heavy ? 0.03 : 0.012
      mesh.scale.set(width, width, 0.01)
      this.scene.add(mesh)
      this.tracers.push({
        mesh,
        from: from.clone(),
        dir: dir.clone().normalize(),
        distance,
        traveled: 0,
        age: 0,
      })
    }
    if (hit === 'world') {
      this.decal(to, normal)
      this.burst(to, normal, 0x9a948a, 6, 2.5)
      // Dust kicked off the surface.
      for (let i = 0; i < 2; i++) {
        this.puff(to.clone().addScaledVector(normal, 0.05), normal.clone().multiplyScalar(0.5), {
          life: 0.7,
          startSize: 0.12,
          endSize: 0.55,
          opacity: 0.6,
          tint: 0xc4b9a6,
        })
      }
    } else if (hit === 'player') {
      this.bleed(to, dir.normalize(), false)
    }
  }

  /**
   * Blood where a bullet hit someone: a spray continuing in the bullet's direction, a splat on
   * whatever is right behind them and drips on the floor. `kill` makes it bigger.
   */
  bleed(at: THREE.Vector3, dir: THREE.Vector3, kill: boolean): void {
    const spray = dir.clone().multiplyScalar(0.8)
    this.burst(at, spray, 0x8a1212, kill ? 22 : 12, kill ? 3.2 : 2.4, 0.5)
    this.burst(at, dir.clone().negate().multiplyScalar(0.4), 0xb32e2e, kill ? 8 : 4, 1.4, 0.35)
    const behind = this.raycast(at, dir, 2.5)
    if (behind) {
      this.bloodMark(
        at.clone().addScaledVector(dir, behind.distance),
        behind.normal,
        kill ? 0.75 : 0.45,
      )
    }
    const down = new THREE.Vector3(0, -1, 0)
    const floor = this.raycast(at, down, 3)
    if (floor) {
      const drip = at.clone().addScaledVector(down, floor.distance)
      drip.x += (Math.random() - 0.5) * 0.4
      drip.z += (Math.random() - 0.5) * 0.4
      this.bloodMark(drip, floor.normal, kill ? 0.5 : 0.3)
    }
  }

  /** Someone died here: a pool on the floor under them, plus a burst. */
  deathPool(feet: THREE.Vector3): void {
    const at = feet.clone().add(new THREE.Vector3(0, 1.1, 0))
    this.burst(at, new THREE.Vector3(0, 0.6, 0), 0x8a1212, 16, 2.6, 0.6)
    const floor = this.raycast(at, new THREE.Vector3(0, -1, 0), 3)
    if (floor) {
      const spot = at.clone().add(new THREE.Vector3(0, -floor.distance, 0))
      this.bloodMark(spot, floor.normal, 1.1 + Math.random() * 0.3)
    }
  }

  private bloodMark(at: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    const mark = this.blood[this.bloodIndex++ % MAX_BLOOD]
    if (!mark) return
    placeFlat(mark.mesh, at, normal, 0.006, size)
    mark.mesh.visible = true
    mark.material.opacity = 1
    mark.life = BLOOD_LIFE
  }

  /** Gun smoke: a few puffs at the barrel that drift, rise, grow and fade. */
  private muzzleSmoke(at: THREE.Vector3, dir: THREE.Vector3, heavy: boolean, own: boolean): void {
    const start = own ? at.clone().addScaledVector(dir, 0.3) : at
    const count = heavy ? 5 : 2
    for (let i = 0; i < count; i++) {
      const vel = dir
        .clone()
        .multiplyScalar(0.5 + Math.random() * 0.8)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            0.25 + Math.random() * 0.2,
            (Math.random() - 0.5) * 0.3,
          ),
        )
      this.puff(start.clone().addScaledVector(dir, i * 0.08), vel, {
        life: heavy ? 1.6 : 1.1,
        startSize: heavy ? 0.12 : 0.08,
        endSize: heavy ? 1.1 : 0.6,
        opacity: (heavy ? 0.75 : 0.6) * (own ? 0.6 : 1),
        tint: 0xd0d0d0,
      })
    }
  }

  private puff(
    at: THREE.Vector3,
    vel: THREE.Vector3,
    o: { life: number; startSize: number; endSize: number; opacity: number; tint: number },
  ): void {
    const p = this.smoke[this.smokeIndex++ % MAX_SMOKE]
    if (!p) return
    p.sprite.position.copy(at)
    p.vel.copy(vel)
    p.maxLife = p.life = o.life * (0.8 + Math.random() * 0.4)
    p.startSize = o.startSize
    p.endSize = o.endSize * (0.85 + Math.random() * 0.3)
    p.opacity = o.opacity
    p.material.color.setHex(o.tint)
    p.material.rotation = Math.random() * Math.PI * 2
    p.sprite.visible = true
  }

  /** Spits a spent casing out of the ejection port. */
  ejectCasing(at: THREE.Vector3, velocity: THREE.Vector3): void {
    const c = this.casings[this.casingIndex++ % MAX_CASINGS]
    if (!c) return
    c.mesh.position.copy(at)
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0)
    c.vel.copy(velocity)
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30)
    c.life = CASING_LIFE
    c.bounced = false
    c.mesh.visible = true
  }

  private flashLight(at: THREE.Vector3): void {
    const slot = this.lights[this.lightIndex++ % this.lights.length]
    if (!slot) return
    slot.light.position.copy(at)
    slot.life = 0.06
  }

  private decal(at: THREE.Vector3, normal: THREE.Vector3): void {
    const decal = this.decals[this.decalIndex++ % MAX_DECALS]
    if (!decal) return
    placeFlat(decal, at, normal, 0.005, 1)
    decal.visible = true
  }

  private burst(
    at: THREE.Vector3,
    normal: THREE.Vector3,
    color: number,
    count: number,
    speed: number,
    lifetime = 0.3,
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleIndex++ % MAX_PARTICLES]
      if (!p) continue
      p.mesh.position.copy(at)
      p.vel
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(1.2)
        .add(normal)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8))
      ;(p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color)
      p.maxLife = p.life = lifetime * (0.8 + Math.random() * 0.9)
      p.mesh.visible = true
    }
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]
      if (!t) continue
      t.traveled += TRACER_SPEED * dt
      t.age += dt
      const head = Math.min(t.traveled, t.distance)
      // The tail keeps flying after the head hits, so the streak shrinks into the impact and
      // is gone — never left hanging in the air.
      const tail = Math.min(Math.max(0, t.traveled - TRACER_LENGTH), t.distance)
      if (tail >= t.distance - 0.01 || t.age > TRACER_MAX_AGE) {
        this.scene.remove(t.mesh)
        this.tracers.splice(i, 1)
        continue
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head)
      t.mesh.lookAt(t.mesh.position.clone().add(t.dir))
      t.mesh.scale.z = Math.max(0.01, head - tail)
    }

    for (const p of this.particles) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) {
        p.mesh.visible = false
        continue
      }
      p.vel.y -= GRAVITY * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.scale.setScalar(p.life / p.maxLife)
    }

    this.updateCasings(dt)

    for (const p of this.smoke) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) {
        p.sprite.visible = false
        continue
      }
      const t = 1 - p.life / p.maxLife // 0 → 1 over its life
      // Slows down quickly (air drag), keeps rising gently.
      p.vel.multiplyScalar(Math.exp(-3 * dt))
      p.vel.y += 0.15 * dt
      p.sprite.position.addScaledVector(p.vel, dt)
      p.sprite.scale.setScalar(p.startSize + (p.endSize - p.startSize) * Math.sqrt(t))
      p.material.opacity = p.opacity * (1 - t) * Math.min(1, t * 8) // quick fade-in, slow fade-out
      p.material.rotation += dt * 0.4
    }

    for (const mark of this.blood) {
      if (mark.life <= 0) continue
      mark.life -= dt
      if (mark.life <= 0) mark.mesh.visible = false
      else mark.material.opacity = Math.min(1, mark.life / BLOOD_FADE)
    }

    for (const slot of this.lights) {
      slot.life = Math.max(0, slot.life - dt)
      slot.light.intensity = slot.life > 0 ? 14 : 0
    }
  }

  private updateCasings(dt: number): void {
    const step = new THREE.Vector3()
    for (const c of this.casings) {
      if (c.life <= 0) continue
      c.life -= dt
      if (c.life <= 0) {
        c.mesh.visible = false
        continue
      }
      c.vel.y -= GRAVITY * dt
      step.copy(c.vel).multiplyScalar(dt)
      const length = step.length()
      if (length > 1e-5) {
        const hit = this.raycast(c.mesh.position, step.clone().divideScalar(length), length + 0.01)
        if (hit) {
          // Bounce: reflect off the surface, lose most of the energy.
          c.mesh.position.addScaledVector(step, Math.max(0, hit.distance - 0.01) / length)
          const into = c.vel.dot(hit.normal)
          c.vel.addScaledVector(hit.normal, -1.4 * into).multiplyScalar(0.45)
          c.spin.multiplyScalar(0.5)
          if (!c.bounced) {
            c.bounced = true
            this.onCasingHit?.(c.mesh.position.clone())
          }
        } else {
          c.mesh.position.add(step)
        }
      }
      c.mesh.rotation.x += c.spin.x * dt
      c.mesh.rotation.y += c.spin.y * dt
      c.mesh.rotation.z += c.spin.z * dt
    }
  }
}

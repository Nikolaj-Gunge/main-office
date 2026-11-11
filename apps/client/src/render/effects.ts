import * as THREE from 'three'

const TRACER_SPEED = 300 // m/s — far slower than a real bullet, so you can see it travel
const TRACER_LENGTH = 3
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
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  maxLife: number
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
      const light = new THREE.PointLight(0xffb060, 0, 8, 2)
      scene.add(light)
      this.lights.push({ light, life: 0 })
    }
  }

  /** A bullet from `from` to `to`; `hit` decides the impact effect at the end. */
  shot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    normal: THREE.Vector3,
    hit: 'world' | 'player' | 'nothing',
    heavy = false,
  ): void {
    this.flashLight(from)
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
      this.tracers.push({ mesh, from: from.clone(), dir: dir.normalize(), distance, traveled: 0 })
    }
    if (hit === 'world') {
      this.decal(to, normal)
      this.burst(to, normal, 0x9a948a, 6, 2.5)
    } else if (hit === 'player') {
      this.burst(to, normal, 0xb32e2e, 8, 2)
    }
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
    decal.position.copy(at).addScaledVector(normal, 0.005)
    decal.lookAt(at.clone().add(normal))
    decal.rotateZ(Math.random() * Math.PI)
    decal.updateMatrix()
    decal.visible = true
  }

  private burst(
    at: THREE.Vector3,
    normal: THREE.Vector3,
    color: number,
    count: number,
    speed: number,
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
      p.maxLife = p.life = 0.25 + Math.random() * 0.3
      p.mesh.visible = true
    }
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]
      if (!t) continue
      t.traveled += TRACER_SPEED * dt
      const head = Math.min(t.traveled, t.distance)
      const tail = Math.max(0, head - TRACER_LENGTH)
      if (tail >= t.distance - 0.01) {
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

    for (const slot of this.lights) {
      slot.life = Math.max(0, slot.life - dt)
      slot.light.intensity = slot.life > 0 ? 6 : 0
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

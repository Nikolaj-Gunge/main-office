import {
  type BodyPart,
  createPhysicsWorld,
  DEFAULT_MOVEMENT,
  GROUP_MAP,
  type MapDef,
  type PartName,
  type PhysicsWorld,
  PLAYER_COLORS,
  RAPIER,
  setGates,
} from '@office-fps/shared'
import * as THREE from 'three'
import { type BodyLook, buildBody, placePart } from './avatar.ts'

const quat = (q: { x: number; y: number; z: number; w: number }) =>
  new THREE.Quaternion(q.x, q.y, q.z, q.w)

/** Collision group of ragdoll parts: they hit the map, never each other or players. */
const GROUP_RAGDOLL = 0x0004
const RAGDOLL_GROUPS = (GROUP_RAGDOLL << 16) | GROUP_MAP
const STEP = 1 / 60
const MAX_STEPS_PER_FRAME = 3
const MAX_RAGDOLLS = 10
/** Seconds a body lies there, then how long it takes to sink into the floor. */
const LIE_SECONDS = 9
const SINK_SECONDS = 1.5

/** How the body is pushed when it falls: away from the shooter, harder for big guns. */
export interface DeathPush {
  /** Unit direction the bullet travelled. */
  dir: THREE.Vector3
  /** Speed added to the hit part (m/s). */
  speed: number
  headshot: boolean
}

interface Ragdoll {
  parts: { body: RAPIER.RigidBody; mesh: THREE.Group }[]
  material: THREE.MeshLambertMaterial
  age: number
}

/**
 * Cosmetic ragdolls for players who die: a few rigid parts joined at the neck, shoulders and
 * hips, falling under gravity in their own physics world (a copy of the map's colliders), so
 * nothing here can disturb movement prediction. Each client simulates its own; nothing is sent.
 */
export class Ragdolls {
  private readonly scene: THREE.Scene
  private readonly physics: PhysicsWorld
  private readonly ragdolls: Ragdoll[] = []
  private accumulator = 0

  constructor(scene: THREE.Scene, map: MapDef) {
    this.scene = scene
    this.physics = createPhysicsWorld(map)
    this.setGravity(1)
    this.physics.world.timestep = STEP
  }

  /** Open gates (co-op maps) stop holding bodies up. */
  setGates(open: (id: number) => boolean): void {
    setGates(this.physics, open)
  }

  /** Game rules gravity multiplier (moon gravity makes bodies float down slowly). */
  setGravity(multiplier: number): void {
    this.physics.world.gravity = { x: 0, y: -DEFAULT_MOVEMENT.gravity * multiplier, z: 0 }
  }

  /**
   * Drops a ragdoll where a player died, starting from the exact pose they were drawn in.
   * @param parts    their body parts as last drawn (skeleton.ts)
   * @param velocity how they were moving (keeps running bodies tumbling forward)
   */
  spawn(
    skin: BodyLook,
    colorIndex: number,
    parts: BodyPart[],
    size: number,
    velocity: THREE.Vector3,
    push: DeathPush,
  ): void {
    if (this.ragdolls.length >= MAX_RAGDOLLS) {
      const oldest = this.ragdolls.shift()
      if (oldest) this.remove(oldest)
    }
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    const material = new THREE.MeshLambertMaterial({ color })
    const meshes = buildBody(skin, colorIndex, material)
    const world = this.physics.world
    const hit: PartName = push.headshot ? 'head' : 'chest'
    const bodies = new Map<PartName, { body: RAPIER.RigidBody; part: BodyPart }>()
    const placed: { body: RAPIER.RigidBody; mesh: THREE.Group }[] = []

    for (const p of parts) {
      if (p.name === 'gun') continue
      const mesh = meshes[p.name]
      const kick = push.dir.clone().multiplyScalar(p.name === hit ? push.speed : push.speed * 0.35)
      const v = velocity.clone().add(kick)
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.center.x, p.center.y, p.center.z)
          .setRotation(p.rotation)
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({
            x: (Math.random() - 0.5) * 2,
            y: (Math.random() - 0.5) * 2,
            z: (Math.random() - 0.5) * 2,
          })
          .setLinearDamping(0.2)
          .setAngularDamping(1.5)
          .setCcdEnabled(true),
      )
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.half.x, p.half.y, p.half.z)
          .setCollisionGroups(RAGDOLL_GROUPS)
          .setFriction(0.9)
          .setRestitution(0.05),
        body,
      )
      placePart(mesh, p, size)
      mesh.matrixAutoUpdate = true
      this.scene.add(mesh)
      bodies.set(p.name, { body, part: p })
      placed.push({ body, mesh })
    }

    // Joints where the parts meet: neck, waist, shoulders, hips, knees.
    const end = (name: PartName, sign: 1 | -1) => {
      const b = bodies.get(name)
      if (!b) return null
      const up = new THREE.Vector3(0, b.part.half.y * sign, 0).applyQuaternion(
        quat(b.part.rotation),
      )
      return new THREE.Vector3(b.part.center.x, b.part.center.y, b.part.center.z).add(up)
    }
    const join = (a: PartName, b: PartName, anchor: THREE.Vector3 | null) => {
      const A = bodies.get(a)
      const B = bodies.get(b)
      if (!A || !B || !anchor) return
      const local = (x: { part: BodyPart }) =>
        anchor
          .clone()
          .sub(new THREE.Vector3(x.part.center.x, x.part.center.y, x.part.center.z))
          .applyQuaternion(quat(x.part.rotation).invert())
      const la = local(A)
      const lb = local(B)
      world.createImpulseJoint(
        RAPIER.JointData.spherical({ x: la.x, y: la.y, z: la.z }, { x: lb.x, y: lb.y, z: lb.z }),
        A.body,
        B.body,
        true,
      )
    }
    join('head', 'chest', end('chest', 1))
    join('chest', 'stomach', end('chest', -1))
    join('chest', 'armL', end('armL', -1)) // arms run shoulder (−Y) → hand (+Y)
    join('chest', 'armR', end('armR', -1))
    join('stomach', 'thighL', end('thighL', 1)) // legs run foot/knee (−Y) → hip/knee (+Y)
    join('stomach', 'thighR', end('thighR', 1))
    join('thighL', 'shinL', end('shinL', 1))
    join('thighR', 'shinR', end('shinR', 1))

    const ragdoll: Ragdoll = { parts: placed, material, age: 0 }
    this.ragdolls.push(ragdoll)
    this.sync(ragdoll, 0)
  }

  update(dt: number): void {
    if (this.ragdolls.length === 0) return
    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_STEPS_PER_FRAME)
    while (this.accumulator >= STEP) {
      this.physics.world.step()
      this.accumulator -= STEP
    }
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i]
      if (!r) continue
      r.age += dt
      if (r.age > LIE_SECONDS + SINK_SECONDS) {
        this.remove(r)
        this.ragdolls.splice(i, 1)
        continue
      }
      const sink = Math.max(0, r.age - LIE_SECONDS) / SINK_SECONDS
      this.sync(r, sink * 0.6)
    }
  }

  /** Copies the physics bodies onto the meshes (`sink` m lower as they disappear). */
  private sync(r: Ragdoll, sink: number): void {
    for (const { body, mesh } of r.parts) {
      const t = body.translation()
      const q = body.rotation()
      mesh.position.set(t.x, t.y - sink, t.z)
      mesh.quaternion.set(q.x, q.y, q.z, q.w)
    }
  }

  private remove(r: Ragdoll): void {
    for (const { body, mesh } of r.parts) {
      this.scene.remove(mesh)
      this.physics.world.removeRigidBody(body)
    }
    r.material.dispose()
  }

  clear(): void {
    for (const r of this.ragdolls) this.remove(r)
    this.ragdolls.length = 0
  }
}

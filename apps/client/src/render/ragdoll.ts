import {
  createPhysicsWorld,
  DEFAULT_MOVEMENT,
  GROUP_MAP,
  type MapDef,
  type PhysicsWorld,
  RAPIER,
  type SkinId,
} from '@office-fps/shared'
import * as THREE from 'three'
import { ragdollSpec } from './avatar.ts'

/** Collision group of ragdoll parts: they hit the map, never each other or players. */
const GROUP_RAGDOLL = 0x0004
const RAGDOLL_GROUPS = (GROUP_RAGDOLL << 16) | GROUP_MAP
const STEP = 1 / 60
const MAX_STEPS_PER_FRAME = 3
const MAX_RAGDOLLS = 10
/** Seconds a body lies there, then how long it takes to sink into the floor. */
const LIE_SECONDS = 9
const SINK_SECONDS = 1.5
/** Crouched height / standing height (as in the hitboxes). */
const CROUCH_SCALE = DEFAULT_MOVEMENT.crouchHeight / DEFAULT_MOVEMENT.standHeight

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

  /** Game rules gravity multiplier (moon gravity makes bodies float down slowly). */
  setGravity(multiplier: number): void {
    this.physics.world.gravity = { x: 0, y: -DEFAULT_MOVEMENT.gravity * multiplier, z: 0 }
  }

  /**
   * Drops a ragdoll where a player died.
   * @param pose     where they stood (feet), facing `yaw`, crouched 0–1
   * @param velocity how they were moving (keeps running bodies tumbling forward)
   */
  spawn(
    skin: SkinId,
    colorIndex: number,
    pose: { x: number; y: number; z: number; yaw: number; crouch: number },
    scale: number,
    velocity: THREE.Vector3,
    push: DeathPush,
  ): void {
    if (this.ragdolls.length >= MAX_RAGDOLLS) {
      const oldest = this.ragdolls.shift()
      if (oldest) this.remove(oldest)
    }
    const spec = ragdollSpec(skin, colorIndex)
    const world = this.physics.world
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw)
    const crouchK = 1 + (CROUCH_SCALE - 1) * pose.crouch
    /** Standing-pose point → world. */
    const toWorld = ([x, y, z]: [number, number, number]) =>
      new THREE.Vector3(x * scale, y * scale * crouchK, z * scale)
        .applyQuaternion(rotation)
        .add(new THREE.Vector3(pose.x, pose.y, pose.z))

    const hitIndex = push.headshot && spec.parts.length > 1 ? 1 : 0
    const parts = spec.parts.map((part, i) => {
      const at = toWorld(part.center)
      const kick = push.dir.clone().multiplyScalar(i === hitIndex ? push.speed : push.speed * 0.35)
      const v = velocity.clone().add(kick)
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(at.x, at.y, at.z)
          .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({
            x: (Math.random() - 0.5) * 3,
            y: (Math.random() - 0.5) * 3,
            z: (Math.random() - 0.5) * 3,
          })
          .setLinearDamping(0.2)
          .setAngularDamping(1.5)
          .setCcdEnabled(true),
      )
      const [hx, hy, hz] = part.half.map((h) => h * scale) as [number, number, number]
      const shape =
        part.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(hy, hx)
          : RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      world.createCollider(
        shape.setCollisionGroups(RAGDOLL_GROUPS).setFriction(0.9).setRestitution(0.05),
        body,
      )
      part.mesh.scale.setScalar(scale)
      part.mesh.matrixAutoUpdate = true
      this.scene.add(part.mesh)
      return { body, mesh: part.mesh, center: at }
    })

    for (const joint of spec.joints) {
      const a = parts[joint.a]
      const b = parts[joint.b]
      if (!a || !b) continue
      const anchor = toWorld(joint.anchor)
      const local = (p: { center: THREE.Vector3 }) =>
        anchor.clone().sub(p.center).applyQuaternion(rotation.clone().invert())
      const la = local(a)
      const lb = local(b)
      world.createImpulseJoint(
        RAPIER.JointData.spherical({ x: la.x, y: la.y, z: la.z }, { x: lb.x, y: lb.y, z: lb.z }),
        a.body,
        b.body,
        true,
      )
    }

    const ragdoll: Ragdoll = {
      parts: parts.map(({ body, mesh }) => ({ body, mesh })),
      material: spec.material,
      age: 0,
    }
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

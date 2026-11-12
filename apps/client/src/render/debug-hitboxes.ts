import { type Hitbox, type HitPose, poseHitboxes } from '@office-fps/shared'
import * as THREE from 'three'

/** Wireframe set of one player's hitboxes. Built once, re-posed every frame. */
class HitboxRig {
  readonly group = new THREE.Group()
  private readonly meshes: THREE.Mesh[] = []

  constructor(color: number) {
    const material = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
      fog: false,
    })
    // One box per hitbox, in poseHitboxes order; unit-sized and scaled per pose.
    for (const _ of poseHitboxes({ x: 0, y: 0, z: 0, yaw: 0, crouch: 0 })) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material)
      mesh.renderOrder = 10
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
  }

  pose(pose: HitPose): void {
    poseHitboxes(pose).forEach((box, i) => {
      const mesh = this.meshes[i]
      if (mesh) place(mesh, box)
    })
  }
}

function place(mesh: THREE.Mesh, box: Hitbox): void {
  mesh.position.set(box.center.x, box.center.y, box.center.z)
  mesh.quaternion.set(box.rotation.x, box.rotation.y, box.rotation.z, box.rotation.w)
  mesh.scale.set(box.half.x, box.half.y, box.half.z)
}

/**
 * F4 debug view for lag compensation: green = hitboxes where *you* see other players right now,
 * red = where the server placed them when it checked your last shot (should overlap the green
 * ones at the moment you fired), plus the shot ray.
 */
export class DebugHitboxes {
  enabled = false
  private readonly scene: THREE.Scene
  private readonly local = new Map<number, HitboxRig>()
  private readonly server: HitboxRig[] = []
  private readonly ray: THREE.Line
  private serverLife = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false }),
    )
    this.ray.visible = false
    this.ray.renderOrder = 10
    scene.add(this.ray)
  }

  /** Draw where you currently see each player. */
  updateLocal(poses: Map<number, HitPose>): void {
    for (const [id, rig] of this.local) {
      if (!this.enabled || !poses.has(id)) {
        this.scene.remove(rig.group)
        this.local.delete(id)
      }
    }
    if (!this.enabled) return
    for (const [id, pose] of poses) {
      let rig = this.local.get(id)
      if (!rig) {
        rig = new HitboxRig(0x30e1b9)
        this.local.set(id, rig)
        this.scene.add(rig.group)
      }
      rig.pose(pose)
    }
  }

  /** Show the server's rewound poses for a shot for a few seconds. */
  showServer(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    poses: HitPose[],
  ): void {
    if (!this.enabled) return
    while (this.server.length < poses.length) {
      const rig = new HitboxRig(0xe83b3b)
      this.server.push(rig)
      this.scene.add(rig.group)
    }
    this.server.forEach((rig, i) => {
      const pose = poses[i]
      rig.group.visible = pose !== undefined
      if (pose) rig.pose(pose)
    })
    const o = new THREE.Vector3(origin.x, origin.y, origin.z)
    const end = o.clone().addScaledVector(new THREE.Vector3(dir.x, dir.y, dir.z), 60)
    this.ray.geometry.setFromPoints([o, end])
    this.ray.visible = true
    this.serverLife = 3
  }

  update(dt: number): void {
    this.serverLife -= dt
    const show = this.enabled && this.serverLife > 0
    this.ray.visible = show
    for (const rig of this.server) if (!show) rig.group.visible = false
  }
}

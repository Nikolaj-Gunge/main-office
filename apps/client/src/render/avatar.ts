import { DEFAULT_MOVEMENT, PLAYER_COLORS, type RemotePlayerState } from '@office-fps/shared'
import * as THREE from 'three'
import { createLabel } from './labels.ts'

const m = DEFAULT_MOVEMENT
const capsuleLength = m.standHeight - m.radius * 2
const sharedGeometry = {
  body: new THREE.CapsuleGeometry(m.radius, capsuleLength, 4, 12),
  visor: new THREE.BoxGeometry(0.36, 0.1, 0.12),
  gun: new THREE.BoxGeometry(0.05, 0.08, 0.3),
}
const visorMaterial = new THREE.MeshLambertMaterial({ color: 0x1b1d2a })
const gunMaterial = new THREE.MeshLambertMaterial({ color: 0x2b2d33 })
/** Gun muzzle relative to the head (right, slightly down, forward). */
const MUZZLE_OFFSET = new THREE.Vector3(0.25, -0.2, -0.55)

/**
 * Placeholder player model (phase 9 replaces it): a capsule in the player's color, a dark visor
 * showing where they look, a gun held at the right, and a name tag.
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly material: THREE.MeshLambertMaterial
  private readonly head = new THREE.Group()
  private readonly muzzle = new THREE.Object3D()
  private readonly label: THREE.Sprite

  constructor(name: string, colorIndex: number) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true })
    this.body = new THREE.Mesh(sharedGeometry.body, this.material)
    this.body.castShadow = true
    this.body.position.y = m.standHeight / 2

    const visor = new THREE.Mesh(sharedGeometry.visor, visorMaterial)
    visor.position.set(0, 0, -m.radius + 0.02)
    const gun = new THREE.Mesh(sharedGeometry.gun, gunMaterial)
    gun.position.set(0.25, -0.2, -0.38)
    this.muzzle.position.copy(MUZZLE_OFFSET)
    this.head.add(visor, gun, this.muzzle)

    this.label = createLabel(name)
    this.root.add(this.body, this.head, this.label)
    this.root.name = `avatar:${name}`
  }

  update(s: RemotePlayerState, timeMs: number): void {
    const height = m.standHeight + (m.crouchHeight - m.standHeight) * s.crouch
    const eye = m.standEyeHeight + (m.crouchEyeHeight - m.standEyeHeight) * s.crouch
    this.root.visible = s.alive
    this.root.position.set(s.x, s.y, s.z)
    this.root.rotation.y = s.yaw
    this.body.scale.y = height / m.standHeight
    this.body.position.y = height / 2
    this.head.position.y = eye
    this.head.rotation.x = s.pitch
    this.label.position.y = height + 0.35
    // Spawn protection: blink so attackers know shots won't count yet.
    this.material.opacity = s.protected && Math.floor(timeMs / 150) % 2 === 0 ? 0.35 : 1
  }

  /** World position of this player's gun muzzle (for their tracers and flashes). */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true)
    return target.setFromMatrixPosition(this.muzzle.matrixWorld)
  }

  dispose(): void {
    this.material.dispose()
    const labelMaterial = this.label.material as THREE.SpriteMaterial
    labelMaterial.map?.dispose()
    labelMaterial.dispose()
  }
}

import { DEFAULT_MOVEMENT, PLAYER_COLORS, type RemotePlayerState } from '@office-fps/shared'
import * as THREE from 'three'
import { createLabel } from './labels.ts'

const m = DEFAULT_MOVEMENT
const capsuleLength = m.standHeight - m.radius * 2
const sharedGeometry = {
  body: new THREE.CapsuleGeometry(m.radius, capsuleLength, 4, 12),
  visor: new THREE.BoxGeometry(0.36, 0.1, 0.12),
}
const visorMaterial = new THREE.MeshLambertMaterial({ color: 0x1b1d2a })

/**
 * Placeholder player model (phase 9 replaces it): a capsule in the player's color, a dark visor
 * showing where they look, and a name tag.
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly head = new THREE.Group()
  private readonly label: THREE.Sprite

  constructor(name: string, colorIndex: number) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.body = new THREE.Mesh(sharedGeometry.body, new THREE.MeshLambertMaterial({ color }))
    this.body.castShadow = true
    this.body.position.y = m.standHeight / 2

    const visor = new THREE.Mesh(sharedGeometry.visor, visorMaterial)
    visor.position.set(0, 0, -m.radius + 0.02)
    this.head.add(visor)

    this.label = createLabel(name)
    this.root.add(this.body, this.head, this.label)
    this.root.name = `avatar:${name}`
  }

  update(s: RemotePlayerState): void {
    const height = m.standHeight + (m.crouchHeight - m.standHeight) * s.crouch
    const eye = m.standEyeHeight + (m.crouchEyeHeight - m.standEyeHeight) * s.crouch
    this.root.position.set(s.x, s.y, s.z)
    this.root.rotation.y = s.yaw
    this.body.scale.y = height / m.standHeight
    this.body.position.y = height / 2
    this.head.position.y = eye
    this.head.rotation.x = s.pitch
    this.label.position.y = height + 0.35
  }

  dispose(): void {
    ;(this.body.material as THREE.Material).dispose()
    const labelMaterial = this.label.material as THREE.SpriteMaterial
    labelMaterial.map?.dispose()
    labelMaterial.dispose()
  }
}

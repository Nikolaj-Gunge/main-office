import type { PerspectiveCamera } from 'three'
import type { Keyboard } from '../input/keyboard.ts'
import type { MouseLook } from '../input/mouse-look.ts'

const SPEED = 8
const FAST_SPEED = 24

/** Noclip camera for debugging and level inspection (toggle with V). */
export class FreeFly {
  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly keys: Keyboard,
    private readonly look: MouseLook,
  ) {
    camera.rotation.order = 'YXZ'
  }

  update(dt: number): void {
    const { camera, keys, look } = this
    camera.rotation.set(look.pitch, look.yaw, 0)

    const forward = keys.axis('KeyS', 'KeyW')
    const strafe = keys.axis('KeyA', 'KeyD')
    const vertical = keys.axis('ControlLeft', 'Space') || keys.axis('KeyC', 'Space')
    const speed = (keys.isDown('ShiftLeft') ? FAST_SPEED : SPEED) * dt

    // Move along the full view direction (pitch included) like a classic noclip.
    const sy = Math.sin(look.yaw)
    const cy = Math.cos(look.yaw)
    const cp = Math.cos(look.pitch)
    const sp = Math.sin(look.pitch)
    camera.position.x += (-sy * cp * forward + cy * strafe) * speed
    camera.position.y += (sp * forward + vertical) * speed
    camera.position.z += (-cy * cp * forward - sy * strafe) * speed
  }
}

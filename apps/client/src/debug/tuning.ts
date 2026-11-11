import { DEFAULT_MOVEMENT, jumpHeight } from '@office-fps/shared'
import type GUI from 'lil-gui'
import { DEFAULT_CAMERA_FEEL } from '../game/camera-feel.ts'
import type { LocalPlayer } from '../game/local-player.ts'

/**
 * Live-tuning folders for movement and camera feel. Deliberately *not* persisted: these values
 * must match the server. Tune here, then "copy as code" and paste into the shared defaults.
 */
export function addTuningFolders(gui: GUI, player: LocalPlayer): void {
  const m = player.movement
  const readout = { jumpHeight: jumpHeight(m).toFixed(2) }

  const move = gui.addFolder('Movement (not saved)')
  move.add(m, 'walkSpeed', 2, 10, 0.1)
  move.add(m, 'sprintMultiplier', 1, 2, 0.05)
  move.add(m, 'crouchSpeed', 1, 5, 0.1)
  move.add(m, 'groundAccel', 1, 30, 0.5)
  move.add(m, 'friction', 1, 15, 0.5)
  move.add(m, 'stopSpeed', 0, 5, 0.1)
  move.add(m, 'airAccel', 0, 10, 0.1)
  move.add(m, 'gravity', 5, 40, 0.5)
  move.add(m, 'jumpVelocity', 2, 12, 0.1)
  move.add(readout, 'jumpHeight').name('→ jump height (m)').disable()
  move.add(m, 'stepHeight', 0, 0.8, 0.05)
  move.add(m, 'maxSlopeDeg', 10, 80, 1)
  move.add(m, 'coyoteTime', 0, 0.3, 0.01)
  move.add(m, 'jumpBufferTime', 0, 0.3, 0.01)
  move.onChange(() => {
    readout.jumpHeight = jumpHeight(m).toFixed(2)
    move.controllersRecursive().forEach((ctrl) => {
      ctrl.updateDisplay()
    })
    player.applyMovement()
  })

  const f = player.feel.config
  const feel = gui.addFolder('Camera feel (not saved)')
  feel.add(f, 'bobHeight', 0, 0.15, 0.005)
  feel.add(f, 'bobSway', 0, 0.1, 0.005)
  feel.add(f, 'strideLength', 0.5, 4, 0.1)
  feel.add(f, 'strafeRollDeg', 0, 5, 0.1)
  feel.add(f, 'landingDip', 0, 0.06, 0.002)
  feel.add(f, 'stepSmoothTime', 0, 0.3, 0.01)

  const actions = {
    copy: () => {
      const json = JSON.stringify({ movement: m, cameraFeel: f }, null, 2)
      void navigator.clipboard.writeText(json)
      console.log(json)
    },
    reset: () => {
      Object.assign(m, DEFAULT_MOVEMENT)
      Object.assign(f, DEFAULT_CAMERA_FEEL)
      player.applyMovement()
      for (const ctrl of gui.controllersRecursive()) ctrl.updateDisplay()
    },
  }
  const tools = gui.addFolder('Tuning tools')
  tools.add(actions, 'copy').name('copy values as JSON')
  tools.add(actions, 'reset').name('reset movement + feel')
  move.close()
  feel.close()
}

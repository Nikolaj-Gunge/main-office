import { Button, type PlayerInput } from '@office-fps/shared'
import type { Keyboard } from './keyboard.ts'
import type { MouseLook } from './mouse-look.ts'

/** Key bindings by `KeyboardEvent.code`. Phase 7 makes these rebindable. */
const BINDINGS: [Button, string[]][] = [
  [Button.Forward, ['KeyW']],
  [Button.Back, ['KeyS']],
  [Button.Left, ['KeyA']],
  [Button.Right, ['KeyD']],
  [Button.Jump, ['Space']],
  // Ctrl+W closes the tab in most browsers, so C is the safe default crouch.
  [Button.Crouch, ['KeyC', 'ControlLeft']],
  [Button.Sprint, ['ShiftLeft']],
  [Button.Fire, ['Mouse0']],
  [Button.Aim, ['Mouse2']],
  [Button.Reload, ['KeyR']],
]

/** Samples one tick of input. Taps shorter than a tick still register via `consumePressed`. */
export function samplePlayerInput(keys: Keyboard, look: MouseLook): PlayerInput {
  let buttons = 0
  for (const [button, codes] of BINDINGS) {
    for (const code of codes) {
      if (keys.isDown(code) || keys.consumePressed(code)) buttons |= button
    }
  }
  return { buttons, yaw: look.yaw, pitch: look.pitch }
}

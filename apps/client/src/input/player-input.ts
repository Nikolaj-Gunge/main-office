import type { PlayerInput } from '@office-fps/shared'
import { ACTIONS, type Keybinds } from './bindings.ts'
import type { Keyboard } from './keyboard.ts'
import type { MouseLook } from './mouse-look.ts'

/** Samples one tick of input. Taps shorter than a tick still register via `consumePressed`. */
export function samplePlayerInput(keys: Keyboard, look: MouseLook, binds: Keybinds): PlayerInput {
  let buttons = 0
  for (const action of ACTIONS) {
    if (!action.button) continue
    for (const code of binds[action.id]) {
      if (keys.isDown(code) || keys.consumePressed(code)) buttons |= action.button
    }
  }
  return { buttons, yaw: look.yaw, pitch: look.pitch }
}

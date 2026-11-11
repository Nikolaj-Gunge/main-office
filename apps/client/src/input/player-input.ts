import { Button, type PlayerInput } from '@office-fps/shared'
import { ACTIONS, type Keybinds } from './bindings.ts'
import type { Keyboard } from './keyboard.ts'
import type { MouseLook } from './mouse-look.ts'

/**
 * Hold-to-aim, or toggle: each press of the aim key flips aiming on/off (comfortable on a
 * trackpad, where holding a two-finger click is awkward).
 */
export class AimState {
  toggle = false
  latched = false

  /** Drop out of aim (death, reload, weapon switch). */
  release(): void {
    this.latched = false
  }
}

/** Samples one tick of input. Taps shorter than a tick still register via `consumePressed`. */
export function samplePlayerInput(
  keys: Keyboard,
  look: MouseLook,
  binds: Keybinds,
  aim: AimState,
): PlayerInput {
  let buttons = 0
  for (const action of ACTIONS) {
    if (!action.button) continue
    if (action.button === Button.Aim && aim.toggle) {
      for (const code of binds[action.id]) if (keys.consumePressed(code)) aim.latched = !aim.latched
      if (aim.latched) buttons |= Button.Aim
      continue
    }
    for (const code of binds[action.id]) {
      // Always consume the press flag (even while held) so it can't linger past the release.
      const tapped = keys.consumePressed(code)
      if (keys.isDown(code) || tapped) buttons |= action.button
    }
  }
  return { buttons, yaw: look.yaw, pitch: look.pitch }
}

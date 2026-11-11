import { Button } from '@office-fps/shared'

/**
 * Every rebindable action. `button` = the input bit sent to the server; actions without one are
 * handled by the client UI. Codes are `KeyboardEvent.code` (layout-independent), `Mouse0/1/2`
 * for mouse buttons and `Wheel` for a wheel notch.
 */
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', button: Button.Forward, defaults: ['KeyW'] },
  { id: 'back', label: 'Move back', button: Button.Back, defaults: ['KeyS'] },
  { id: 'left', label: 'Move left', button: Button.Left, defaults: ['KeyA'] },
  { id: 'right', label: 'Move right', button: Button.Right, defaults: ['KeyD'] },
  { id: 'jump', label: 'Jump', button: Button.Jump, defaults: ['Space'] },
  // Ctrl+W closes the tab in most browsers, so C is the safe default crouch.
  { id: 'crouch', label: 'Crouch', button: Button.Crouch, defaults: ['KeyC', 'ControlLeft'] },
  {
    id: 'sprint',
    label: 'Sprint / hold breath (scoped)',
    button: Button.Sprint,
    defaults: ['ShiftLeft'],
  },
  { id: 'fire', label: 'Shoot', button: Button.Fire, defaults: ['Mouse0'] },
  { id: 'aim', label: 'Aim / scope', button: Button.Aim, defaults: ['Mouse2'] },
  { id: 'reload', label: 'Reload', button: Button.Reload, defaults: ['KeyR'] },
  { id: 'primary', label: 'Primary weapon', button: Button.Slot1, defaults: ['Digit1'] },
  { id: 'secondary', label: 'Handgun', button: Button.Slot2, defaults: ['Digit2'] },
  { id: 'swap', label: 'Switch weapon', button: Button.SwapWeapon, defaults: ['KeyQ', 'Wheel'] },
  { id: 'scoreboard', label: 'Scoreboard (hold)', button: 0, defaults: ['Tab'] },
  { id: 'mute', label: 'Mute sound', button: 0, defaults: ['KeyM'] },
] as const

export type ActionId = (typeof ACTIONS)[number]['id']
export type Keybinds = Record<ActionId, string[]>

export function defaultKeybinds(): Keybinds {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.defaults]])) as Keybinds
}

/** Fills in actions missing from saved bindings (e.g. ones added in a later version). */
export function withDefaults(saved: Partial<Keybinds> | undefined): Keybinds {
  const binds = defaultKeybinds()
  for (const a of ACTIONS) {
    const codes = saved?.[a.id]
    if (Array.isArray(codes)) binds[a.id] = codes.filter((c) => typeof c === 'string')
  }
  return binds
}

/**
 * Binds `code` as the main key for `action`. A key can only do one thing: it is removed from
 * every other action first. The previous main key stays as the alternate.
 */
export function rebind(binds: Keybinds, action: ActionId, code: string): void {
  for (const a of ACTIONS) binds[a.id] = binds[a.id].filter((c) => c !== code)
  binds[action] = [code, ...binds[action]].slice(0, 2)
}

export function actionFor(binds: Keybinds, code: string): ActionId | undefined {
  return ACTIONS.find((a) => binds[a.id].includes(code))?.id
}

const NAMED: Record<string, string> = {
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  Wheel: 'Wheel',
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt',
  AltRight: 'R-Alt',
  Tab: 'Tab',
  CapsLock: 'Caps',
  Backquote: '`',
}

/** Short, readable name for a key code: KeyW → W, Digit1 → 1, Mouse0 → LMB. */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  if (code.startsWith('Arrow')) return code.slice(5)
  return code
}

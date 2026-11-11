import { describe, expect, test } from 'bun:test'
import { Button } from '@office-fps/shared'
import { defaultKeybinds } from './bindings.ts'
import type { Keyboard } from './keyboard.ts'
import type { MouseLook } from './mouse-look.ts'
import { AimState, samplePlayerInput } from './player-input.ts'

/** Minimal stand-in for Keyboard: what's held and what was pressed since the last read. */
function fakeKeys() {
  const down = new Set<string>()
  const pressed = new Set<string>()
  const keys = {
    isDown: (code: string) => down.has(code),
    consumePressed: (code: string) => pressed.delete(code),
  } as unknown as Keyboard
  return {
    keys,
    press(code: string) {
      down.add(code)
      pressed.add(code)
    },
    release(code: string) {
      down.delete(code)
    },
  }
}

const look = { yaw: 0, pitch: 0 } as MouseLook
const binds = defaultKeybinds()
const aiming = (keys: Keyboard, aim: AimState) =>
  (samplePlayerInput(keys, look, binds, aim).buttons & Button.Aim) !== 0

describe('aim input', () => {
  test('hold mode: aims only while the button is held', () => {
    const k = fakeKeys()
    const aim = new AimState()
    k.press('Mouse2')
    expect(aiming(k.keys, aim)).toBe(true)
    expect(aiming(k.keys, aim)).toBe(true)
    k.release('Mouse2')
    expect(aiming(k.keys, aim)).toBe(false)
  })

  test('toggle mode: a click scopes in and stays in; the next click scopes out', () => {
    const k = fakeKeys()
    const aim = new AimState()
    aim.toggle = true
    k.press('Mouse2')
    k.release('Mouse2') // a quick two-finger click
    expect(aiming(k.keys, aim)).toBe(true)
    expect(aiming(k.keys, aim)).toBe(true)
    k.press('Mouse2')
    k.release('Mouse2')
    expect(aiming(k.keys, aim)).toBe(false)
  })

  test('toggle mode: release() drops out of the scope (reload, switch, death)', () => {
    const k = fakeKeys()
    const aim = new AimState()
    aim.toggle = true
    k.press('Mouse2')
    expect(aiming(k.keys, aim)).toBe(true)
    aim.release()
    expect(aiming(k.keys, aim)).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { actionFor, defaultKeybinds, keyLabel, rebind, withDefaults } from './bindings.ts'

describe('keybinds', () => {
  test('defaults cover every action', () => {
    const b = defaultKeybinds()
    expect(b.forward).toEqual(['KeyW'])
    expect(b.swap).toEqual(['KeyQ', 'Wheel'])
    expect(actionFor(b, 'Mouse0')).toBe('fire')
  })

  test('rebinding moves a key off its old action and keeps one alternate', () => {
    const b = defaultKeybinds()
    rebind(b, 'jump', 'KeyW')
    expect(b.jump).toEqual(['KeyW', 'Space'])
    expect(b.forward).toEqual([])
    rebind(b, 'jump', 'KeyF')
    expect(b.jump).toEqual(['KeyF', 'KeyW'])
  })

  test('saved bindings survive, missing actions get defaults, junk is dropped', () => {
    const b = withDefaults({ fire: ['Mouse2'], aim: [42 as unknown as string, 'Mouse0'] })
    expect(b.fire).toEqual(['Mouse2'])
    expect(b.aim).toEqual(['Mouse0'])
    expect(b.reload).toEqual(['KeyR'])
  })

  test('readable key names', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('Digit2')).toBe('2')
    expect(keyLabel('Mouse0')).toBe('LMB')
    expect(keyLabel('ShiftLeft')).toBe('L-Shift')
  })
})

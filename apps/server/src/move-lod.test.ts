import { describe, expect, test } from 'bun:test'
import { Button, type InputCommand } from '@office-fps/shared'
import type { ServerPlayer } from './game.ts'
import { MoveLod } from './move-lod.ts'

const at = (id: number, x: number, zombie: boolean) =>
  ({
    id,
    state: { pos: { x, y: 0, z: 0 }, alive: true },
    ...(zombie ? { zombie: { kind: 0, face() {} } } : {}),
  }) as unknown as ServerPlayer
const cmd = (buttons: number): InputCommand => ({ seq: 1, buttons, yaw: 0, pitch: 0, viewTick: 0 })

describe('move lod', () => {
  test('the dead far from everyone move every other tick, keeping their presses', () => {
    const lod = new MoveLod(2)
    const person = at(1, 0, false)
    const near = at(2, 30, true)
    const far = at(3, 200, true)
    lod.update(0, [person, near, far])
    expect(lod.gate(near, cmd(0), 1)).toBe(1)
    expect(lod.gate(far, cmd(Button.Fire), 1)).toBe(0)
    const next = cmd(Button.Forward)
    expect(lod.gate(far, next, 2)).toBe(2)
    expect(next.buttons & Button.Fire).toBeTruthy()
    // Somebody walks up: back to every tick at the next recheck.
    person.state.pos.x = 180
    lod.update(15, [person, near, far])
    expect(lod.gate(far, cmd(0), 17)).toBe(1)
  })

  test('a stride of 1 (or a steered zombie) never holds anything back', () => {
    const lod = new MoveLod(1)
    const far = at(3, 500, true)
    lod.update(0, [at(1, 0, false), far])
    expect(lod.gate(far, cmd(0), 1)).toBe(1)
    const lod2 = new MoveLod(2)
    const steered = at(4, 500, true)
    ;(steered.zombie as unknown as { steered: boolean }).steered = true
    lod2.update(0, [at(1, 0, false), steered])
    expect(lod2.gate(steered, cmd(0), 1)).toBe(1)
  })
})

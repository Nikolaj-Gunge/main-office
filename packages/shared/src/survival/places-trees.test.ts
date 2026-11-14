import { beforeAll, describe, expect, test } from 'bun:test'
import { TICK_DT } from '../constants.ts'
import { createPhysicsWorld, initPhysics, type PhysicsWorld } from '../physics/world.ts'
import { Button } from '../sim/input.ts'
import { DEFAULT_MOVEMENT } from '../sim/movement-config.ts'
import { createPlayerState, PlayerBody, stepPlayer } from '../sim/player.ts'
import { emptyBuild, Site } from './kit.ts'
import type { Climb } from './places-trees.ts'
import { standClimb, treehouseClimb } from './places-trees.ts'
import { buildDeadwood, placeTurn } from './world.ts'

const map = buildDeadwood()
const def = map.survival
let physics: PhysicsWorld

beforeAll(async () => {
  await initPhysics()
  physics = createPhysicsWorld(map)
})

/** Stands at the foot of a place's climb and walks up it for a few seconds; returns the rise. */
function climb(key: string, how: (variant: number) => Climb): { rise: number; top: number } {
  const index = def?.pois.findIndex((p) => p.key === key) ?? -1
  const poi = def?.pois[index]
  if (!poi) throw new Error(`no ${key}`)
  const variant = Number(key.split('_')[1]) - 1
  const c = how(variant)
  const site = new Site(emptyBuild(), poi, index, 0, 0, placeTurn(key))
  const [x, y, z] = site.world(c.x, 0.05, c.z)
  const body = new PlayerBody(physics, { ...DEFAULT_MOVEMENT })
  const yaw = site.yaw(0)
  const state = createPlayerState({ pos: [x, y, z], yaw })
  for (let t = 0; t < Math.round(4 / TICK_DT); t++) {
    stepPlayer(state, { buttons: Button.Forward, yaw, pitch: 0 }, TICK_DT, body)
  }
  return { rise: state.pos.y - poi.y, top: c.top }
}

describe('treehouses and hunting stands', () => {
  test('there are plenty of them, and of houses, all hidden until found', () => {
    const count = (kind: string) => def?.pois.filter((p) => p.kind === kind).length ?? 0
    expect(count('house')).toBeGreaterThanOrEqual(20)
    expect(count('treehouse')).toBeGreaterThanOrEqual(15)
    expect(count('stand')).toBeGreaterThanOrEqual(10)
    for (const p of def?.pois ?? []) {
      if (['house', 'camper', 'shed', 'treehouse', 'stand'].includes(p.kind)) {
        expect(p.hidden).toBe(true)
      }
    }
  })

  test('nothing scattered comes near Haven', () => {
    const haven = def?.pois.find((p) => p.safe)
    if (!haven) throw new Error('no Haven')
    for (const p of def?.pois ?? []) {
      if (p === haven || p.kind === 'start') continue
      if (!['house', 'camper', 'shed', 'treehouse', 'stand'].includes(p.kind)) continue
      expect(Math.hypot(p.x - haven.x, p.z - haven.z)).toBeGreaterThan(haven.r + 150)
    }
  })

  test('you can walk up the stairs and the ladders into the trees', () => {
    // treehouse_1 has stairs, treehouse_2 a ladder; stand_1 is a ladder stand, stand_2 a box blind.
    for (const [key, how] of [
      ['treehouse_1', treehouseClimb],
      ['treehouse_2', treehouseClimb],
      ['treehouse_5', treehouseClimb],
      ['stand_1', standClimb],
      ['stand_2', standClimb],
    ] as const) {
      const { rise, top } = climb(key, how)
      expect(rise, key).toBeGreaterThan(top - 0.15)
      expect(rise, key).toBeLessThan(top + 0.6)
    }
  })
})

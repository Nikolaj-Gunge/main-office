import { describe, expect, test } from 'bun:test'
import {
  buildDeadwood,
  ITEMS,
  type ItemDef,
  type Poi,
  type QuestStep,
  type SurvivalDef,
} from '@office-fps/shared'
import {
  bearingTo,
  effectText,
  headingOf,
  stepLine,
  turnBetween,
  whereText,
} from './survival-hud.ts'

describe('compass', () => {
  test('heading is degrees clockwise from north', () => {
    expect(headingOf(0)).toBeCloseTo(0)
    // + yaw turns left, so a quarter turn left faces west.
    expect(headingOf(Math.PI / 2)).toBeCloseTo(270)
    expect(headingOf(-Math.PI / 2)).toBeCloseTo(90)
  })

  test('bearing points at the target (x east, z south)', () => {
    const o = { x: 0, z: 0 }
    expect(bearingTo(o, { x: 0, z: -10 })).toBeCloseTo(0)
    expect(bearingTo(o, { x: 10, z: 0 })).toBeCloseTo(90)
    expect(bearingTo(o, { x: 0, z: 10 })).toBeCloseTo(180)
    expect(bearingTo(o, { x: -10, z: 0 })).toBeCloseTo(270)
  })

  test('turns take the short way round', () => {
    expect(turnBetween(10, 350)).toBeCloseTo(20)
    expect(turnBetween(350, 10)).toBeCloseTo(-20)
    expect(turnBetween(90, 90)).toBeCloseTo(0)
  })
})

describe('backpack text', () => {
  const item = (id: string) => ITEMS[id] as ItemDef

  test('says what food, medicine and guns do', () => {
    expect(effectText(item('water'))).toContain('water')
    expect(effectText(item('bandage'))).toContain('stops bleeding')
    expect(effectText(item('glock'))).toContain('9mm')
    expect(effectText(item('pack_hiking'))).toContain('kg')
  })
})

describe('quest lines', () => {
  const state = { id: 'q', step: 0, count: 0 }

  test('kill and hold steps count', () => {
    const kill: QuestStep = { kind: 'kill', n: 5, text: 'Thin the herd' } as QuestStep
    expect(stepLine(kill, { ...state, count: 2 }, [])).toBe('Thin the herd (2/5)')
    const hold: QuestStep = { kind: 'hold', seconds: 60, text: 'Hold out' } as QuestStep
    expect(stepLine(hold, { ...state, count: 45 }, [])).toBe('Hold out (15 s)')
  })

  test('collect steps count the bits that are set', () => {
    const collect = {
      kind: 'collect',
      targets: ['a', 'b', 'c'],
      text: 'Find the tags',
    } as QuestStep
    expect(stepLine(collect, { ...state, count: 0b101 }, [])).toBe('Find the tags (2/3)')
  })

  test('fetch steps count what you carry, capped at what is asked', () => {
    const fetch: QuestStep = {
      kind: 'fetch',
      npc: 'dot',
      item: 'beans',
      n: 3,
      text: 'Bring Dot beans',
      say: '',
    }
    expect(stepLine(fetch, state, [{ item: 'beans', n: 2 }])).toBe('Bring Dot beans (2/3)')
    expect(stepLine(fetch, state, [{ item: 'beans', n: 9 }])).toBe('Bring Dot beans (3/3)')
  })
})

describe('quest directions', () => {
  const def = buildDeadwood().survival as SurvivalDef
  const haven = def.pois.find((p) => p.key === 'haven') as Poi

  test('names the place, the direction and the distance', () => {
    const from = { x: haven.x, z: haven.z + 640 }
    expect(whereText(def, from, haven)).toBe('Haven · N · 640 m')
    expect(whereText(def, { x: haven.x - 2000, z: haven.z }, haven)).toBe('Haven · E · 2.0 km')
  })

  test('says so when you are there', () => {
    expect(whereText(def, { x: haven.x + 5, z: haven.z }, haven)).toBe('Haven · here')
  })
})

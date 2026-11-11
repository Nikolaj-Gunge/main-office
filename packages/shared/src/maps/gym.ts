import { MapBuilder } from './builder.ts'
import type { MapDef } from './types.ts'

/**
 * Metrics test map. Every dimension here mirrors the metrics table in PLAN.md §4.1 so movement,
 * cover and sightlines can be felt before the real map exists.
 *
 * Layout (top-down, -Z is "north", spawn is in the south looking north):
 *
 *   z=-50 ┌──────────────────────────────┬────────┐
 *         │ stairs+mezz   ramps          │ sight- │
 *         │                              │ line   │
 *   z=5   ├─ doorways (1.0 … 4.0 m) ─────┤ lane   │
 *         │ cover: low / high / pillar   │ 10-80m │
 *         │ step test 0.2 … 1.2 m        │        │
 *   z=50  └──────────── spawn ───────────┴────────┘
 *        x=-30                          x=21     x=30
 */
export function buildGym(): MapDef {
  const m = new MapBuilder('gym', 'Gym', {
    sunDirection: [0.45, 1, 0.3],
    sunColor: 0xfff1d6,
    sunIntensity: 2.6,
    skyColor: 0x9ec7ff,
    groundColor: 0x5a4a3a,
    ambientIntensity: 1.1,
    fogColor: 0xb4c8dc,
    fogNear: 30,
    fogFar: 140,
  })

  const X0 = -30
  const X1 = 30
  const Z0 = -50
  const Z1 = 50
  const WALL_H = 6
  const WALL_T = 0.5

  // Ground + perimeter.
  m.span([X0, -0.5, Z0], [X1, 0, Z1], 'floor')
  m.span([X0 - WALL_T, 0, Z0 - WALL_T], [X1 + WALL_T, WALL_H, Z0], 'wall')
  m.span([X0 - WALL_T, 0, Z1], [X1 + WALL_T, WALL_H, Z1 + WALL_T], 'wall')
  m.span([X0 - WALL_T, 0, Z0], [X0, WALL_H, Z1], 'wall')
  m.span([X1, 0, Z0], [X1 + WALL_T, WALL_H, Z1], 'wall')

  // Spawns along the south wall, looking north.
  for (const x of [-20, -10, 0, 10]) m.spawn(x, 0, 45, 0)

  // --- Step test: step-up limit is 0.4 m, jump height ~1.0 m ---------------------------------
  const steps = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2]
  steps.forEach((h, i) => {
    const x = -26 + i * 2.5
    m.block(x, 0, 32, 1.5, h, 2, 'marker')
    m.label(x, h + 0.5, 32, `${h.toFixed(1)} m`)
  })
  m.label(-17, 2.4, 32, 'STEP / JUMP')

  // --- Cover: low 1.0 m (crouch hides, stand shoots over), high 1.9 m, pillar, crates ---------
  m.block(-24, 0, 20, 3, 1.0, 0.6, 'cover').label(-24, 1.5, 20, 'low 1.0 m')
  m.block(-18, 0, 20, 3, 1.9, 0.6, 'cover').label(-18, 2.4, 20, 'high 1.9 m')
  m.block(-12, 0, 20, 0.8, 3, 0.8, 'cover').label(-12, 3.5, 20, 'pillar')
  m.block(-6, 0, 20, 1.2, 1.2, 1.2, 'cover')
  m.block(-6, 1.2, 20, 1.2, 1.2, 1.2, 'cover').label(-6, 2.9, 20, 'crates 1.2 m')
  m.block(-4.6, 0, 20, 1.2, 1.2, 1.2, 'cover')

  // --- Doorway wall: widths 1.0 / 1.4 / 2.0 / 3.0 / 4.0 m, 2.4 m tall -------------------------
  const DOOR_Z = 5
  const DOOR_H = 2.4
  const DOOR_WALL_H = 3.5
  const doors = [
    { x: -24, w: 1.0 },
    { x: -16, w: 1.4 },
    { x: -8, w: 2.0 },
    { x: 0, w: 3.0 },
    { x: 10, w: 4.0 },
  ]
  let cursor = X0
  for (const { x, w } of doors) {
    const left = x - w / 2
    const right = x + w / 2
    m.span([cursor, 0, DOOR_Z - 0.15], [left, DOOR_WALL_H, DOOR_Z + 0.15], 'wall')
    m.span([left, DOOR_H, DOOR_Z - 0.15], [right, DOOR_WALL_H, DOOR_Z + 0.15], 'wall')
    m.label(x, DOOR_H + 0.55, DOOR_Z + 0.3, `${w.toFixed(1)} m`)
    cursor = right
  }
  m.span([cursor, 0, DOOR_Z - 0.15], [21, DOOR_WALL_H, DOOR_Z + 0.15], 'wall')

  // --- Mezzanine: 4 m floor-to-floor, stairs 0.25 rise / 0.3 run ------------------------------
  const MEZZ_H = 4
  m.span([-28, 0, -20], [-20, MEZZ_H, -12], 'platform')
  const STEP_RISE = 0.25
  const STEP_RUN = 0.3
  const stepCount = MEZZ_H / STEP_RISE
  for (let i = 1; i <= stepCount; i++) {
    const zFar = -12 + (stepCount - i) * STEP_RUN
    m.span([-28, 0, zFar + STEP_RUN], [-26, i * STEP_RISE, zFar], 'platform')
  }
  m.label(-27, 1.6, -6.5, 'stairs 0.25/0.3')
  m.label(-24, MEZZ_H + 1.2, -16, 'mezzanine 4 m')
  // Low parapet on the mezzanine edge: cover from above.
  m.span([-26, MEZZ_H, -12.3], [-20, MEZZ_H + 1.0, -12], 'cover')

  // --- Ramps: 20° / 35° / 45° (max walkable) / 50° (too steep) -------------------------------
  const ramps = [20, 35, 45, 50]
  ramps.forEach((angle, i) => {
    const x = -14 + i * 5
    const run = 3
    const rise = m.ramp(x, 0, -8, 3, run, angle)
    m.span([x - 1.5, 0, -8 - run], [x + 1.5, rise, -8 - run - 2], 'platform')
    m.label(x, rise + 0.8, -8 - run - 1, `${angle}°`)
  })

  // --- Sightline lane: 8 m wide, targets every 10 m from the spawn line -----------------------
  const LANE_WALL_X = 21
  m.span([LANE_WALL_X, 0, Z0], [LANE_WALL_X + 0.5, WALL_H, 36], 'wall')
  const LANE_ORIGIN_Z = 45
  for (let d = 10; d <= 80; d += 10) {
    const z = LANE_ORIGIN_Z - d
    m.block(27, 0, z, 0.6, 1.8, 0.1, 'target')
    m.block(24.5, 0, z, 0.4, 0.05, 0.4, 'marker')
    m.label(24.5, 0.6, z, `${d} m`)
  }

  m.randomSpawnsIn([X0 + 0.5, Z0 + 0.5], [20.5, Z1 - 0.5])
  m.pickup(-15, 0, 40, 1)
  m.pickup(-5, 0, 40, 2)
  m.pickup(5, 0, 40, 1)
  m.pickup(-24, 4, -16, 2) // on the mezzanine
  return m.build()
}

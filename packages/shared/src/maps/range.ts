import { MapBuilder } from './builder.ts'
import type { MapDef } from './types.ts'

/** Distances (m from the firing line) of the training dummies, one per lane. */
export const RANGE_DISTANCES = [5, 10, 20, 30, 50, 75, 100] as const

/**
 * "Shooting range": one long, empty hall for testing guns. You stand behind the firing line at
 * the south end; training dummies stand at fixed distances down the hall, each in its own lane,
 * facing you. They never move, turn or shoot, and come back a second after you drop them.
 * Floor stripes every 5 m and labels every 10 m measure the distance.
 *
 *   z = 6   back wall ─ spawn area ─ firing line (z = 0)
 *   z = −5 … −100   dummies at RANGE_DISTANCES (lanes from west to east)
 *   z = −110 end wall
 */
export function buildRange(): MapDef {
  const m = new MapBuilder('range', 'Shooting range', {
    sunDirection: [0.3, 1, 0.2],
    sunColor: 0xfff4e0,
    sunIntensity: 0.6,
    skyColor: 0xdfe6ef,
    groundColor: 0x55504a,
    ambientIntensity: 1.6,
    fogColor: 0xc9d1dc,
    fogNear: 140,
    fogFar: 400,
  })
  const X0 = -9
  const X1 = 9
  const Z0 = -110
  const Z1 = 6
  const H = 7
  const T = 0.4

  m.span([X0 - T, -0.5, Z0 - T], [X1 + T, 0, Z1 + T], 'floor')
  m.span([X0 - T, H, Z0 - T], [X1 + T, H + 0.3, Z1 + T], 'ceiling')
  m.span([X0 - T, 0, Z0 - T], [X1 + T, H, Z0], 'wall') // far end
  m.span([X0 - T, 0, Z1], [X1 + T, H, Z1 + T], 'wall') // behind you
  m.span([X0 - T, 0, Z0], [X0, H, Z1], 'wall')
  m.span([X1, 0, Z0], [X1 + T, H, Z1], 'wall')

  // Firing line and distance stripes (render only, flush on the floor).
  const deco = { collide: false } as const
  m.span([X0, 0, -0.05], [X1, 0.01, 0.05], 'marker', deco)
  for (let d = 5; d <= 105; d += 5) {
    m.span([X0, 0, -d - 0.04], [X1, 0.01, -d + 0.04], d % 10 === 0 ? 'marker' : 'platform', deco)
    if (d % 10 === 0) m.label(X0 + 1.2, 0.3, -d, `${d} m`)
  }
  // A waist-high bench along the firing line (there's a gap to walk round at each end).
  m.span([X0 + 2, 0, 0.6], [X1 - 2, 1.0, 1.0], 'desk')

  // Dummies: one lane each, spread across the hall so none hides another.
  const lanes = RANGE_DISTANCES.length
  RANGE_DISTANCES.forEach((d, i) => {
    const x = X0 + 1.5 + (i * (X1 - X0 - 3)) / (lanes - 1)
    m.target(x, 0, -d, 180) // facing the firing line
    m.label(x, 2.3, -d, `${d} m`)
  })

  // Light down the whole hall.
  for (let z = 0; z >= -105; z -= 15) {
    m.light({ kind: 'point', pos: [0, H - 0.6, z], color: 0xfff1dc, intensity: 18, distance: 18 })
  }

  // Every gun on the floor in the spawn area, back 2 s after it's taken (walk over one with an
  // empty slot, or press E to swap). Full ammo each time.
  const RIFLE = 1
  const SNIPER = 2
  const SHOTGUN = 3
  const MP5 = 5
  m.pickup(-4, 0, 3.4, RIFLE, 2)
  m.pickup(-1.3, 0, 3.4, SHOTGUN, 2)
  m.pickup(1.3, 0, 3.4, SNIPER, 2)
  m.pickup(4, 0, 3.4, MP5, 2)
  m.label(0, 0.6, 4.4, 'GUNS')

  m.spawn(0, 0, 3, 0)
  m.randomSpawnsIn([X0 + 1, 1.6], [X1 - 1, Z1 - 0.8]) // only behind the firing line
  return m.build()
}

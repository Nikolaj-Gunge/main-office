import type { Site } from './kit.ts'
import { armyTent, cot, drum, fence, logPile, pupTent } from './places-kit.ts'
import { crate, table } from './structures.ts'

/**
 * The lived-in side of Haven (structures.ts builds its walls, huts and people): washing on a
 * line, firewood, a long table, a garden, more tents, a workbench, a notice board, a string of
 * bulbs over the fire. Everything keeps clear of the gate road (x ±3 from the gate to the fire),
 * the ground south of the fire where people wake, and the trader's and the infirmary's doors.
 * Lamps are warm white and soft.
 */
export function havenLife(s: Site): void {
  // Warm-white bulbs strung on two poles across the square north of the fire (glow only).
  for (const e of [-1, 1]) s.block(e * 7, 0, -4, 0.14, 3.4, 0.14, 'log')
  for (let i = 0; i <= 14; i++) {
    const x = -7 + i
    // The cord sags in the middle.
    const sag = 0.55 * (1 - (x / 7) * (x / 7))
    s.deco(x, 3.25 - sag, -4, 1.02, 0.02, 0.02, 'metal')
    if (i > 0 && i < 14) s.deco(x, 3.13 - sag, -4, 0.07, 0.09, 0.07, 'lightpanel')
  }

  // Firewood by the fire, and a block to split it on.
  s.block(-5.6, 0, -0.6, 1.6, 0.35, 0.7, 'log')
  s.block(-5.6, 0.35, -0.6, 1.4, 0.35, 0.6, 'log')
  s.block(-5.75, 0.7, -0.6, 0.9, 0.3, 0.5, 'log')
  s.block(-5.4, 0, 1.2, 0.5, 0.45, 0.5, 'log')
  s.turned(-5.35, 0.45, 1.15, 0.5, 0.06, 0.06, 35, 'wood', 0.5)
  s.turned(-5.15, 0.75, 1.05, 0.14, 0.12, 0.04, 35, 'metal', 0.5)

  // Notice board east of the square: names of the missing, a map, a rota.
  s.block(5.6, 0, -6.2, 0.12, 2.1, 0.12, 'log').block(7.4, 0, -6.2, 0.12, 2.1, 0.12, 'log')
  s.deco(6.5, 1, -6.2, 1.9, 1, 0.06, 'wood')
  for (const [x, y, w, h] of [
    [5.95, 1.55, 0.22, 0.3],
    [6.3, 1.5, 0.22, 0.3],
    [6.65, 1.58, 0.22, 0.28],
    [7.05, 1.45, 0.3, 0.38],
    [6.0, 1.12, 0.26, 0.24],
    [6.55, 1.1, 0.6, 0.34],
  ] as const) {
    s.deco(x, y - h / 2, -6.15, w, h, 0.02, 'whiteboard')
  }

  // A long table south of the kitchen tent, with benches and a lantern on it.
  table(s, -11, -11.5, 3, 0.9)
  for (const z of [-12.35, -10.65]) s.block(-11, 0, z, 2.8, 0.45, 0.32, 'wood')
  s.deco(-10.3, 0.9, -11.5, 0.14, 0.2, 0.14, 'lantern')
  s.light(-10.3, 1.2, -11.5, { color: 0xffdcb4, intensity: 5, distance: 7, flicker: 0.1 })
  s.deco(-11.8, 0.9, -11.6, 0.3, 0.04, 0.3, 'metal') // a pot
  s.deco(-12.4, 0.9, -11.3, 0.1, 0.12, 0.1, 'plaster') // mugs
  s.deco(-11.4, 0.9, -11.25, 0.1, 0.12, 0.1, 'plaster')

  // A walk-in army tent in the north-west corner: cots, a footlocker, a lantern.
  const tent = s.sub(-20, -23)
  armyTent(tent)
  cot(tent, -1.5, -0.7, false)
  cot(tent, 1.5, -0.7, false)
  crate(tent, 0, -1.8, 0.6)
  tent.lantern(0, 2.4, 0, 0.45, { color: 0xffd6aa, intensity: 5, distance: 7 })

  // Two pup tents along the west wall.
  pupTent(s, -26.6, 2.6)
  pupTent(s, -26.6, -10)

  // Washing on a line between two poles, north of the bunkhouse.
  s.block(-26.5, 0, 8.5, 0.12, 2.1, 0.12, 'log').block(-20.5, 0, 8.5, 0.12, 2.1, 0.12, 'log')
  s.deco(-23.5, 1.98, 8.5, 6, 0.02, 0.02, 'metal')
  for (const [x, w, h, m] of [
    [-25.6, 0.55, 0.7, 'fabric'],
    [-24.7, 0.5, 0.45, 'plaster'],
    [-23.8, 0.6, 0.75, 'fabricAlt'],
    [-22.9, 0.4, 0.5, 'canvas'],
    [-22.1, 0.55, 0.65, 'fabric'],
    [-21.3, 0.35, 0.4, 'plaster'],
  ] as const) {
    s.deco(x, 1.97 - h, 8.5, w, h, 0.03, m)
  }
  // A tub for the washing.
  s.block(-23.5, 0, 9.8, 0.9, 0.4, 0.6, 'metal')

  // Supplies stacked inside the gate, east of it.
  crate(s, 11.4, -27.6, 0.9)
  crate(s, 12.4, -27.5, 0.8)
  crate(s, 11.5, -27.6, 0.7, undefined, 0.9)
  drum(s, 13.6, -27.8)
  drum(s, 14.3, -27.3, 'metal')
  s.block(16.2, 0, -27.8, 2.4, 0.5, 0.9, 'sandbag')

  // A vegetable patch south of the fire, fenced against the kid and the dog, gate to the north.
  s.deco(1, 0, 22.5, 8.4, 0.05, 4.4, 'dirt')
  for (const z of [21, 22.5, 24]) {
    for (let x = -2.6; x <= 4.6; x += 0.9) s.deco(x, 0.05, z, 0.3, 0.28, 0.3, 'plant')
  }
  fence(s, [
    [0, 20],
    [-3.5, 20],
    [-3.5, 25],
    [5.5, 25],
    [5.5, 20],
    [1.6, 20],
  ])
  drum(s, 6.4, 20.8, 'wood')
  drum(s, 6.4, 21.6, 'wood')

  // A workbench outside the workshop: a vice, tools, a saw horse and a lamp on a post.
  s.block(23.6, 0, 9.4, 2.2, 0.9, 0.8, 'wood')
  s.deco(22.9, 0.9, 9.3, 0.2, 0.18, 0.16, 'metal') // vice
  s.deco(23.8, 0.9, 9.5, 0.5, 0.03, 0.06, 'metal') // a saw
  s.deco(24.3, 0.9, 9.2, 0.25, 0.08, 0.15, 'accent') // a toolbox
  s.block(23.6, 0, 11.4, 1.2, 0.7, 0.3, 'wood')
  s.block(25.1, 0, 9.4, 0.1, 2.3, 0.1, 'log')
  s.deco(24.8, 2.2, 9.4, 0.6, 0.06, 0.06, 'log')
  s.lantern(24.6, 2.2, 9.4, 0.35, { color: 0xffdcb4, intensity: 5, distance: 7 })
  logPile(s, 26.6, 13.5, false, 2.4)
}

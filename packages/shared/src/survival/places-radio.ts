import type { LampOptions, Site } from './kit.ts'
import { crate } from './structures.ts'

/**
 * Radio Free Deadwood's booth at Haven (roadmap 6.6): a tin box against the east wall, open to
 * the camp on its west side, with Wes Harlan behind a desk — a microphone on a stand, the set
 * with its dial lit, records on a shelf, a car battery under it all — and an antenna mast on the
 * roof with guy wires and a small red light at the top. Kept clear of Gus's customers (x 18–22).
 */

const DIAL: LampOptions = { color: 0xffc890, intensity: 5, distance: 6, flicker: 0.08 }

/** Centre of the booth, in Haven's own coordinates. */
const BX = 26.2
const BZ = -5.5

export function radioBooth(s: Site): void {
  const t = s.sub(BX, BZ)
  const w = 3.4
  const d = 3
  const h = 2.5
  // Three tin walls and a roof overhanging the open front.
  t.block(0, 0, -d / 2, w, h, 0.12, 'rust')
  t.block(0, 0, d / 2, w, h, 0.12, 'rust')
  t.block(w / 2 - 0.06, 0, 0, 0.12, h, d, 'rust')
  t.block(-0.25, h, 0, w + 0.7, 0.08, d + 0.3, 'rust')
  t.deco(0, 0, 0, w, 0.06, d, 'wood') // plank floor
  // Plank patches, and egg-box padding on the back wall.
  t.deco(-0.8, 0.4, d / 2 + 0.07, 0.9, 0.7, 0.04, 'wood')
  t.deco(w / 2 - 0.13, 0.9, 0, 0.03, 1.2, 1.8, 'canvas')

  // The desk across the front: Wes stands behind it, facing the camp.
  t.block(-0.9, 0, 0, 0.8, 0.85, 2.2, 'wood')
  t.deco(-0.9, 0.85, 0, 0.84, 0.04, 2.24, 'desk')
  // The set: a steel box, its dial glowing, knobs.
  t.deco(-0.95, 0.89, -0.6, 0.45, 0.32, 0.6, 'metal')
  t.deco(-1.18, 0.98, -0.6, 0.02, 0.12, 0.34, 'lantern')
  for (const z of [-0.78, -0.42]) t.deco(-1.19, 0.92, z, 0.03, 0.05, 0.05, 'trim')
  // The microphone: a heavy base, a stand, the head in a cage.
  t.deco(-0.85, 0.89, 0.25, 0.16, 0.03, 0.16, 'metal')
  t.deco(-0.85, 0.92, 0.25, 0.03, 0.34, 0.03, 'metal')
  t.deco(-0.92, 1.24, 0.25, 0.1, 0.16, 0.1, 'rack')
  // Headphones, a mug, papers.
  t.deco(-0.75, 0.89, 0.75, 0.2, 0.06, 0.18, 'fabric')
  t.deco(-0.7, 0.89, -0.05, 0.08, 0.1, 0.08, 'plaster')
  t.deco(-0.95, 0.89, 0.55, 0.3, 0.01, 0.22, 'whiteboard')
  // A car battery under the desk, a cable up to the set.
  t.deco(-0.7, 0.06, -0.6, 0.3, 0.22, 0.2, 'accent')
  t.deco(-0.62, 0.28, -0.6, 0.02, 0.6, 0.02, 'metal')
  // Records on a shelf on the back wall, a crate of spares.
  t.deco(w / 2 - 0.3, 1.3, 0.6, 0.3, 0.04, 1.2, 'wood')
  for (let i = 0; i < 9; i++)
    t.deco(w / 2 - 0.3, 1.34, 0.1 + i * 0.12, 0.26, 0.28, 0.03, i % 3 ? 'screen' : 'fabricAlt')
  crate(t, w / 2 - 0.5, -1, 0.6)
  t.lantern(0.2, h, 0, 0.45, DIAL)
  t.light(-1.15, 1.1, -0.6, { ...DIAL, intensity: 2.5, distance: 3 })

  // The mast on the roof: a pole, cross-pieces, a red light at the top, two guy wires.
  const mx = w / 2 - 0.5
  const top = h + 0.08 + 7
  t.deco(mx, h + 0.08, 0, 0.09, 7, 0.09, 'metal')
  for (const [y, len] of [
    [h + 4.2, 1.6],
    [h + 5.6, 1.2],
    [h + 6.6, 0.8],
  ] as const) {
    t.deco(mx, y, 0, 0.05, 0.05, len, 'metal')
  }
  t.deco(mx, top, 0, 0.14, 0.14, 0.14, 'warnlight')
  for (const e of [-1, 1]) {
    // From a third of the way down the mast to the roof's edge, leaning out north and south.
    const high = h + 5
    const rise = high - (h + 0.08)
    const out = d / 2 + 0.1
    const len = Math.hypot(rise, out)
    t.turned(
      mx,
      (h + 0.08 + high) / 2 - len / 2,
      (e * out) / 2,
      0.02,
      len,
      0.02,
      0,
      'metal',
      -e * Math.atan2(out, rise),
    )
  }
  t.label(-w / 2 - 0.3, h + 0.6, 0, 'RADIO')
  t.npc('wes', 'Wes', 'radio', 0.1, 0.1, 90, 9)
}

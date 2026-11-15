import type { Site } from './kit.ts'
import { blood, drum, pupTent } from './places-kit.ts'
import { deck, ladder } from './places-trees.ts'
import { campfire, crate } from './structures.ts'
import type { Poi } from './types.ts'

/**
 * Bandit camps (ROADMAP 6.10): a few living people who took to the woods and shoot whoever comes
 * close. Tents round a fire, crates stacked for cover, a lookout on stilts, and what they took
 * from everybody else in a crate. The server runs the people (apps/server/src/survival/bandits.ts);
 * this is only the place, and the spots they keep to.
 *
 * Camps are never turned, so the spots below are plain offsets from the camp's centre.
 */

/** The lookout: its deck is this high, here (local x, z). */
export const BANDIT_LOOKOUT = { x: 9, z: 7, y: 3.4 } as const

/** Where the people of a camp stand when nothing is happening (local x, z, height). */
export const BANDIT_POSTS: readonly (readonly [number, number, number])[] = [
  [0.6, 3.2, 0],
  [BANDIT_LOOKOUT.x, BANDIT_LOOKOUT.z, BANDIT_LOOKOUT.y],
  [-6.5, 3.8, 0],
  [6.2, -2, 0],
  [-2.5, -9, 0],
]

/** Crates and drums to duck behind (local x, z, half-width): the camp's own cover. */
export const BANDIT_COVER: readonly (readonly [number, number, number])[] = [
  [3.6, 2.6, 0.45],
  [-3.9, 2.8, 0.45],
  [6.4, 2.2, 0.45],
  [-7.2, -1.5, 0.45],
  [1.4, -4.6, 0.4],
]

/** A walk round the camp's edge (local x, z), for whoever is on watch. */
export const BANDIT_PATROL: readonly (readonly [number, number])[] = [
  [11, -4],
  [5, -11],
  [-6, -10],
  [-11, 0],
  [-7, 9],
  [3, 11],
]

/** Camp of people who rob the living: tents, a lit fire, cover, a lookout and a loot crate. */
export function banditCamp(s: Site, _poi: Poi, variant: number): void {
  campfire(s, 0, 0, true)
  // Logs to sit on round the fire.
  s.block(-1.5, 0, 1.2, 1.4, 0.4, 0.45, 'log')
  s.block(1.7, 0, -1, 0.45, 0.4, 1.4, 'log')
  // A spit over the fire.
  s.deco(-0.7, 0, 0, 0.08, 1.1, 0.08, 'log')
  s.deco(0.7, 0, 0, 0.08, 1.1, 0.08, 'log')
  s.deco(0, 1.0, 0, 1.6, 0.06, 0.06, 'metal')

  pupTent(s, -5, -4, true)
  pupTent(s, 5, -5.5, false)
  pupTent(s, -1.5, -7.5, true)
  // A tarp strung between two poles: where the stolen stuff is kept dry.
  for (const [x, z] of [
    [-8.5, 4.5],
    [-5.5, 4.5],
  ] as const) {
    s.block(x, 0, z, 0.12, 2.2, 0.12, 'log')
  }
  s.turned(-7, 2.0, 5.6, 3.4, 0.05, 2.6, 0, 'canvas', 0.35)

  // Cover: crates in twos and threes, an oil drum.
  for (const [x, z, half] of BANDIT_COVER) crate(s, x, z, half * 2)
  crate(s, 3.6, 2.6, 0.7, undefined, 0.9)
  crate(s, -3.9, 2.8, 0.6, undefined, 0.9)
  drum(s, 7.4, 1.4)
  drum(s, -8, -2.6)

  // The loot crate: what they took off everybody else.
  s.block(-7, 0, 6.3, 1.4, 0.75, 0.9, 'wood')
  s.loot(-7.3, 0.8, 6.3, variant % 2 === 0 ? 'military' : 'gun')
  s.loot(-6.6, 0.8, 6.3, 'camp')
  s.loot(-6.2, 0.05, 4.6, 'pack')

  // The lookout: four poles, a deck, a ladder and a canvas roof.
  const { x, z, y: H } = BANDIT_LOOKOUT
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) s.block(x + dx, 0, z + dz, 0.16, H + 2.1, 0.16, 'log')
  }
  deck(s, x, z, 2.3, 2.3, H, [{ side: 's', at: x, width: 0.9 }], 1)
  ladder(s, x, z + 1.15, H)
  s.deco(x, H + 2.1, z, 2.6, 0.06, 2.6, 'canvas')

  // A lantern by the tents, and what happens to people who come here.
  s.lantern(-5.5, 2.2, 4.5, 0.5, { color: 0xffb060, intensity: 5, distance: 9, flicker: 0.5 })
  blood(s, 2.5, 6.5, 1.4, 1)
  s.turned(2.8, 0.02, 7.4, 0.5, 0.06, 1.7, 30, 'canvas')
}

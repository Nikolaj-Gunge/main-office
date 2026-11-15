import {
  DONATION,
  DONATION_BOX,
  DONATION_BOX_KEY,
  GATE_BANNER,
  MORALE_BOARD,
  MORALE_BOARD_KEY,
} from './camp.ts'
import type { Site } from './kit.ts'

/**
 * Haven's things for the camp (camp.ts), in Haven's own coordinates: the morale board beside the
 * job board, facing the gate road; the donation box at its foot; and the pole the gate's tally
 * banner hangs from (the cloth itself is drawn by the client, counting the Red Nights held).
 */
export function campThings(s: Site): void {
  const [bx, bz] = MORALE_BOARD
  s.block(bx, 0, bz - 0.8, 0.14, 2.2, 0.14, 'log').block(bx, 0, bz + 0.8, 0.14, 2.2, 0.14, 'log')
  s.block(bx, 0.9, bz, 0.08, 1.1, 1.6, 'wood')
  s.deco(bx + 0.05, 2.2, bz, 0.5, 0.06, 1.9, 'shingle')
  s.lantern(bx + 0.35, 2.15, bz, 0.3, { color: 0xffdcb4, intensity: 5, distance: 6 })
  s.interact(MORALE_BOARD_KEY, 'camp', bx + 0.1, 1.4, bz, 'Read the board')

  // A strongbox chained to a stake: a slot in the lid.
  const [dx, dz] = DONATION_BOX
  s.block(dx, 0, dz, 0.12, 0.7, 0.12, 'log')
  s.block(dx, 0.7, dz, 0.5, 0.36, 0.42, 'metal')
  s.deco(dx, 1.06, dz, 0.3, 0.02, 0.05, 'asphalt')
  s.interact(DONATION_BOX_KEY, 'camp', dx, 1, dz, `Give to the camp ($${DONATION})`)

  // The banner pole, out from the palisade west of the gate.
  const [gx, gz] = GATE_BANNER
  s.deco(gx, 3.25, gz + 0.12, 1.5, 0.06, 0.06, 'log')
}

import {
  DEFAULT_WORLD_ID,
  isPublicWorld,
  routeWorld,
  type WorldsReply,
  worldsReply,
} from '@office-fps/shared'
import type { Game } from './game.ts'

/** People in a game (not the dead, practice dummies or bots): what the world list counts. */
export function peopleIn(game: Game): number {
  let n = 0
  for (const p of game.players.values()) if (!p.zombie && !p.dummy && !p.bot) n++
  return n
}

/**
 * The Bun server's worlds (worlds.ts): each world is its own Game in this one process, opened
 * the first time somebody asks for it — the Cloudflare deploy runs each in its own room instead.
 * Maps that aren't the survival map only ever have the one world.
 */
export class WorldHost<W extends { game: Game }> {
  private readonly opening = new Map<string, Promise<W>>()
  private readonly open = new Map<string, W>()

  constructor(
    private readonly openWorld: (worldId: string) => Promise<W>,
    /** False for maps with no worlds: everything goes to the default one. */
    private readonly multi = true,
  ) {}

  /** The world a request's `?world=` names (see routeWorld). */
  route(raw: string | null | undefined): string {
    return this.multi ? routeWorld(raw) : DEFAULT_WORLD_ID
  }

  /** A world, opened if it isn't yet (concurrent callers share the one opening). */
  get(worldId: string): Promise<W> {
    let world = this.opening.get(worldId)
    if (!world) {
      world = this.openWorld(worldId).then((w) => {
        this.open.set(worldId, w)
        return w
      })
      this.opening.set(worldId, world)
    }
    return world
  }

  /** Worlds already open. */
  worlds(): IterableIterator<[string, W]> {
    return this.open.entries()
  }

  /** The public world list with head counts (GET /worlds). */
  reply(): WorldsReply {
    const counts: Record<string, number> = {}
    for (const [id, w] of this.open) if (isPublicWorld(id)) counts[id] = peopleIn(w.game)
    return worldsReply(counts)
  }
}

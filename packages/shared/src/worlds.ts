/**
 * Survival worlds: the same Deadwood map run as several separate rooms ("Deadwood 1", "Deadwood
 * 2"…), each with its own world save (loot taken, barricades, the story). Characters belong to
 * the account, not a world, so the same survivor can walk into any of them.
 *
 * Public worlds are listed in the menu with their head counts; a private world is any random
 * code (`p-xxxxxxxx`) shared by link, and only exists while somebody is in it (on Cloudflare its
 * room sleeps, and costs nothing, when empty).
 */

/** Query parameter naming the world, on the page (`?world=`) and the WebSocket URL. */
export const WORLD_PARAM = 'world'
/** Header the Cloudflare worker uses to tell a room which world it runs. */
export const WORLD_HEADER = 'X-Office-World'

/** The public worlds, in the order they fill. The first is the original (its save key is old). */
export const PUBLIC_WORLDS: readonly { id: string; name: string }[] = [
  { id: 'deadwood-1', name: 'Deadwood 1' },
  { id: 'deadwood-2', name: 'Deadwood 2' },
  { id: 'deadwood-3', name: 'Deadwood 3' },
]

export const DEFAULT_WORLD_ID = 'deadwood-1'

/**
 * People in a world before the picker calls it full and fills the next one. Below the room's
 * hard limit (MAX_PLAYERS, which the dead share), so friends joining by name still fit.
 */
export const WORLD_SOFT_CAP = 16

const PRIVATE_PREFIX = 'p-'
const PRIVATE_CODE = /^p-[a-z0-9]{8}$/
const CODE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'

export const isPublicWorld = (id: string) => PUBLIC_WORLDS.some((w) => w.id === id)
export const isPrivateWorld = (id: string) => PRIVATE_CODE.test(id)

/** A world id from a URL parameter, or null if it isn't one (unknown names, junk). */
export function parseWorldId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const id = raw.trim().toLowerCase()
  return isPublicWorld(id) || isPrivateWorld(id) ? id : null
}

/** A fresh private world code (`p-` and 8 letters/digits, no look-alikes). */
export function privateWorldId(random: () => number = Math.random): string {
  let code = PRIVATE_PREFIX
  for (let i = 0; i < 8; i++) code += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]
  return code
}

/** What the menu calls a world. */
export function worldName(id: string): string {
  return (
    PUBLIC_WORLDS.find((w) => w.id === id)?.name ?? `Private ${id.slice(PRIVATE_PREFIX.length)}`
  )
}

/** One public world as /worlds lists it. */
export interface WorldInfo {
  id: string
  name: string
  players: number
  full: boolean
}

/** The /worlds list: every public world with its head count (missing counts are empty). */
export function listWorlds(counts: Readonly<Record<string, number>>): WorldInfo[] {
  return PUBLIC_WORLDS.map(({ id, name }) => {
    const players = Math.max(0, Math.floor(Number(counts[id]) || 0))
    return { id, name, players, full: players >= WORLD_SOFT_CAP }
  })
}

/**
 * Where somebody who didn't choose goes: the busiest world that isn't full (people want company;
 * ties go to the earlier world), else the emptiest one.
 */
export function pickWorld(worlds: readonly WorldInfo[]): string {
  let best: WorldInfo | null = null
  for (const w of worlds) {
    if (w.full) continue
    if (!best || w.players > best.players) best = w
  }
  if (best) return best.id
  let least: WorldInfo | null = null
  for (const w of worlds) if (!least || w.players < least.players) least = w
  return least?.id ?? DEFAULT_WORLD_ID
}

/** The world a request asked for (`?world=`); anything missing or unknown is the original one. */
export const routeWorld = (raw: string | null | undefined): string =>
  parseWorldId(raw) ?? DEFAULT_WORLD_ID

/**
 * The Cloudflare room (Durable Object name) running a world for one protocol version. The
 * original world keeps the name it always had; each other world (and private code) gets its own.
 */
export function roomName(worldId: string, protocolVersion: number): string {
  const base = `office-v${protocolVersion}`
  return worldId === DEFAULT_WORLD_ID ? base : `${base}-${worldId}`
}

// --- Head counts (the Settings object keeps them for /worlds) -------------------------------

/** Each public world's last reported head count and when it came. */
export type Presence = Record<string, { players: number; at: number }>

/**
 * A head count older than this is ignored (a room that was evicted without saying goodbye).
 * Rooms report on every join and leave, and again every few minutes while anyone is in.
 */
export const PRESENCE_STALE_MS = 15 * 60 * 1000

/** Records a room's head count; private worlds aren't listed, so they aren't kept. */
export function reportPresence(
  presence: Presence,
  worldId: string,
  players: number,
  now: number,
): Presence {
  if (!isPublicWorld(worldId)) return presence
  return { ...presence, [worldId]: { players: Math.max(0, Math.floor(players) || 0), at: now } }
}

/** Current head counts by world (stale reports count as empty). */
export function presenceCounts(presence: Presence, now: number): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [id, p] of Object.entries(presence)) {
    if (now - p.at < PRESENCE_STALE_MS) counts[id] = p.players
  }
  return counts
}

/** What GET /worlds answers. */
export interface WorldsReply {
  worlds: WorldInfo[]
  /** Where somebody who doesn't choose goes (pickWorld). */
  pick: string
}

export function worldsReply(counts: Readonly<Record<string, number>>): WorldsReply {
  const worlds = listWorlds(counts)
  return { worlds, pick: pickWorld(worlds) }
}

/**
 * Link previews ("Join Ellen's camp in Deadwood · Night 23"): what an invite link unfurls as in
 * a chat. Invite links go to `/join?camp=…&world=…&from=…`; the Cloudflare worker answers that
 * path with the game's page and these words in its title and Open Graph tags (worker.ts), so
 * plain visits to `/` stay on the free, unmetered static files.
 */
import { PARTY_PARAM } from './party.ts'
import { isPublicWorld, parseWorldId, WORLD_PARAM, worldName } from './worlds.ts'

/** The path invite links use (the worker fills in the preview). */
export const JOIN_PATH = '/join'
/** Who sent the link (shown in the preview only; the game ignores it). */
export const FROM_PARAM = 'from'

/** A name for the preview: printable, short, no markup (the worker escapes it as well). */
export function cleanFrom(raw: string | null | undefined): string | null {
  if (!raw) return null
  const name = raw
    .replace(/[<>"`]/g, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
  return name || null
}

/** "Join my camp" / "see this world": the game's address on the preview path. */
export function joinLink(
  origin: string,
  opts: { camp?: string | null; world?: string | null; from?: string | null },
): string {
  const q = new URLSearchParams()
  if (opts.camp) q.set(PARTY_PARAM, opts.camp)
  if (opts.world) q.set(WORLD_PARAM, opts.world)
  const from = cleanFrom(opts.from)
  if (from) q.set(FROM_PARAM, from)
  const query = q.toString()
  return `${origin}${JOIN_PATH}${query ? `?${query}` : ''}`
}

/**
 * "Join my camp": the game's address with the camp code on it (and the world and who sent it,
 * for the preview).
 */
export function inviteLink(
  origin: string,
  code: string,
  extra: { world?: string | null; from?: string | null } = {},
): string {
  return joinLink(origin, { camp: code, ...extra })
}

/** What a world's room last told the Settings object (worlds.ts presence), if anything. */
export interface WorldGlance {
  players: number
  /** Which night the world is on (1 = its first). */
  night?: number
}

export interface Preview {
  title: string
  description: string
}

const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`)

/** The preview for a join link's query (`camp`, `world`, `from`) and the world's last glance. */
export function previewFor(params: URLSearchParams, glance: WorldGlance | null): Preview {
  const from = cleanFrom(params.get(FROM_PARAM))
  const camp = params.get(PARTY_PARAM)
  const world = parseWorldId(params.get(WORLD_PARAM))
  // Public worlds by name; private ones are just "Deadwood" (their code means nothing to anyone).
  const where = world && isPublicWorld(world) ? worldName(world) : 'Deadwood'
  const who = from ? `${possessive(from)} camp` : 'a camp'
  const head = camp ? `Join ${who} in ${where}` : `Come to ${where}`
  const night = glance?.night && glance.night > 0 ? ` · Night ${Math.floor(glance.night)}` : ''
  const title = `${head}${night}`
  const players = Math.max(0, Math.floor(glance?.players ?? 0))
  const fire =
    players > 1
      ? `${players} by the fire tonight.`
      : players === 1
        ? 'One by the fire tonight.'
        : 'The fire is still lit.'
  const description = `${fire} ${
    camp
      ? "Somebody's holding a spot for you. Survive the night together"
      : 'Three kilometres of dark forest, a camp called Haven, and the dead'
  } — free, in your browser, no install.`
  return { title, description }
}

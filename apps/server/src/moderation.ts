import { ServerMsg } from '@office-fps/shared'
import { type Game, type ServerPlayer, sanitizeName } from './game.ts'

/** WebSocket close codes the client treats as final (no reconnect): see net/connection.ts. */
export const CLOSE_KICKED = 4002
export const CLOSE_BANNED = 4003

/** WebSocket close reasons are capped at 123 bytes. */
const MAX_REASON = 100

export interface Ban {
  /** The name they played under (matched case-insensitively). */
  name: string
  /** Their address when banned, if known (loopback addresses are never matched). */
  ip?: string
  reason: string
  /** Date.now() when banned. */
  at: number
}

/** What a session tells moderation about its connection. */
export interface Connection {
  ip?: string | undefined
  close(code: number, reason: string): void
}

/** A named spot to send someone to (survival's places). */
export interface Place {
  key: string
  name: string
}

/**
 * Kicks, bans, teleports and the other admin tools that act on people (admin.ts calls these).
 * There are no accounts, so a ban is by name and, where known, by address. Bans live in memory;
 * `onBansChanged` lets the host store them (the Durable Object keeps them in Settings).
 */
export class Moderation {
  private readonly game: Game
  private readonly connections = new Map<number, Connection>()
  private bansValue: Ban[] = []
  onBansChanged: ((bans: readonly Ban[]) => void) | null = null

  constructor(game: Game) {
    this.game = game
  }

  get bans(): readonly Ban[] {
    return this.bansValue
  }

  /** Replaces the ban list (loading what was stored); junk entries are dropped. */
  loadBans(raw: unknown): void {
    if (!Array.isArray(raw)) return
    this.bansValue = raw
      .filter((b): b is Ban => typeof b?.name === 'string' && typeof b?.reason === 'string')
      .map((b) => ({
        name: b.name,
        reason: b.reason,
        at: Number(b.at) || 0,
        ...(typeof b.ip === 'string' ? { ip: b.ip } : {}),
      }))
  }

  // --- Connections (session.ts) --------------------------------------------------------------

  /** The ban keeping this name / address out, if any. */
  banned(rawName: string, ip?: string): Ban | null {
    const name = sanitizeName(rawName).toLowerCase()
    const addr = ip && !isLoopback(ip) ? ip : undefined
    return (
      this.bansValue.find(
        (b) => (name !== '' && b.name.toLowerCase() === name) || (!!addr && b.ip === addr),
      ) ?? null
    )
  }

  connected(playerId: number, connection: Connection): void {
    this.connections.set(playerId, connection)
  }

  disconnected(playerId: number): void {
    this.connections.delete(playerId)
  }

  // --- Admin tools ---------------------------------------------------------------------------

  /** Throws someone out with a reason shown to them. False: nobody (connected) by that id. */
  kick(id: number, reason: string): boolean {
    const player = this.person(id)
    if (!player) return false
    const why = reason.trim() || 'No reason given'
    this.drop(player, CLOSE_KICKED, `Kicked: ${why}`)
    return true
  }

  /** Bans someone online (and kicks them). False: nobody by that id. */
  ban(id: number, reason: string, now = Date.now()): boolean {
    const player = this.person(id)
    if (!player) return false
    const why = reason.trim() || 'No reason given'
    const ip = this.connections.get(id)?.ip
    this.bansValue = [
      ...this.bansValue.filter((b) => b.name.toLowerCase() !== player.name.toLowerCase()),
      { name: player.name, ...(ip && !isLoopback(ip) ? { ip } : {}), reason: why, at: now },
    ]
    this.onBansChanged?.(this.bansValue)
    this.drop(player, CLOSE_BANNED, `Banned: ${why}`)
    return true
  }

  /** Lifts the ban on a name. False: no such ban. */
  unban(name: string): boolean {
    const before = this.bansValue.length
    this.bansValue = this.bansValue.filter((b) => b.name.toLowerCase() !== name.toLowerCase())
    if (this.bansValue.length === before) return false
    this.onBansChanged?.(this.bansValue)
    return true
  }

  /** Survival's named places (none on other maps). */
  places(): Place[] {
    return (this.game.world.map.survival?.pois ?? []).map((p) => ({ key: p.key, name: p.name }))
  }

  /**
   * Moves someone (alive) to a place (`place` key) or next to another player (`to` id).
   * Returns an error message, or null when done.
   */
  teleport(id: number, target: { place?: string; to?: number }): string | null {
    const player = this.person(id)
    if (!player) return 'No such player'
    if (!player.state.alive) return "They're dead: wait for them to respawn"
    let spot: { x: number; y: number; z: number } | null = null
    if (target.to !== undefined) {
      const other = this.game.players.get(target.to)
      if (!other || other === player || !other.state.alive) return 'No such player to go to'
      spot = this.freeSpotNear(player, other.state.pos, 1.5, 4) ?? { ...other.state.pos }
    } else if (target.place !== undefined) {
      const poi = this.game.world.map.survival?.pois.find((p) => p.key === target.place)
      if (!poi) return 'No such place'
      spot = this.freeSpotNear(player, { x: poi.x, y: poi.y, z: poi.z }, 4, Math.max(6, poi.r - 2))
      if (!spot) return 'No room to stand there'
    } else return 'Say where: a place or a player'
    this.game.match.survivalDirector?.unseat(player)
    player.state.pos = spot
    player.state.vel = { x: 0, y: 0, z: 0 }
    return null
  }

  /** Survival: gives someone an item. Returns an error message, or null when done. */
  give(id: number, item: string, n: number): string | null {
    const director = this.game.match.survivalDirector
    if (!director) return 'Not playing survival'
    const player = this.person(id)
    if (!player) return 'No such player'
    const count = Math.max(1, Math.min(999, Math.floor(n) || 1))
    return director.adminGive(player, item, count) ? null : 'No such item'
  }

  /** Survival: starts someone's character over. Returns an error message, or null when done. */
  resetCharacter(id: number): string | null {
    const director = this.game.match.survivalDirector
    if (!director) return 'Not playing survival'
    const player = this.person(id)
    if (!player) return 'No such player'
    return director.resetCharacter(player) ? null : 'They have no character'
  }

  /** Survival: sets the day's clock (0–1). False when not surviving. */
  setTime(t: number): boolean {
    const director = this.game.match.survivalDirector
    if (!director || !Number.isFinite(t)) return false
    director.setTime(((t % 1) + 1) % 1)
    return true
  }

  /** A line from the server to everyone playing (survival's notice feed). */
  broadcast(text: string): void {
    const line = text.trim().slice(0, 200)
    if (!line) return
    this.game.broadcastMessage({
      type: ServerMsg.Notice,
      notice: { kind: 'info', text: `Server: ${line}` },
    })
  }

  // --- Helpers -------------------------------------------------------------------------------

  /** A person (not a zombie, bot or dummy) by id. */
  private person(id: number): ServerPlayer | null {
    const p = this.game.players.get(id)
    return p && !p.zombie && !p.dummy && !p.bot ? p : null
  }

  private drop(player: ServerPlayer, code: number, reason: string): void {
    const connection = this.connections.get(player.id)
    this.connections.delete(player.id)
    this.game.leave(player.id)
    connection?.close(code, reason.slice(0, MAX_REASON))
  }

  /** Somewhere `player` fits standing, on rings from `min` to `max` m around `centre`. */
  private freeSpotNear(
    player: ServerPlayer,
    centre: { x: number; y: number; z: number },
    min: number,
    max: number,
  ): { x: number; y: number; z: number } | null {
    const height = 1.8 * this.game.rules.playerScale
    for (let r = min; r <= max; r += 1.5) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const x = centre.x + Math.sin(a) * r
        const z = centre.z + Math.cos(a) * r
        // Drop from a little above, so a step or a slope doesn't put the feet in the ground.
        for (const up of [0.1, 0.6, 1.2]) {
          const spot = { x, y: centre.y + up, z }
          if (player.body.fits(spot, height)) return spot
        }
      }
    }
    return null
  }
}

/** Every game's moderation (one per Game: sessions and the admin API share it). */
const byGame = new WeakMap<Game, Moderation>()

export function moderationOf(game: Game): Moderation {
  let m = byGame.get(game)
  if (!m) {
    m = new Moderation(game)
    byGame.set(game, m)
  }
  return m
}

function isLoopback(ip: string): boolean {
  return ip === '::1' || ip === 'local' || ip.startsWith('127.') || ip.startsWith('::ffff:127.')
}

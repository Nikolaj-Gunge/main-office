import {
  cleanPartyCode,
  makePartyCode,
  PARTY_MAX,
  type PartyInfo,
  type PartyRequest,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
} from '@office-fps/shared'
import type { ServerPlayer } from './game.ts'

/** What camps need from the game. */
export interface PartyHost {
  readonly players: ReadonlyMap<number, ServerPlayer>
  readonly tick: number
  sendTo(player: ServerPlayer, msg: ServerMessage): void
  /** Somebody just joined a camp with others in it (survival walks a new character over). */
  campJoined?(player: ServerPlayer): void
}

interface Party {
  code: string
  /** Player ids, first in first: the first one leads. */
  members: number[]
}

/**
 * Camps: small groups (up to PARTY_MAX) joined by code, the code that goes in a "join my camp"
 * link. Everybody is always in one, alone to start with. A camp lives only while somebody is in
 * it; its code is made again by whoever comes back with it (clients remember theirs), so a
 * link keeps working through reconnects and server restarts.
 */
export class Parties {
  private readonly byCode = new Map<string, Party>()
  private readonly byPlayer = new Map<number, Party>()
  private readonly host: PartyHost
  private readonly random: () => number

  constructor(host: PartyHost, random: () => number = Math.random) {
    this.host = host
    this.random = random
  }

  handle(from: ServerPlayer, req: PartyRequest): void {
    if (from.zombie || from.bot || from.dummy) return
    if (req.op === 'join') {
      const code = cleanPartyCode(req.code)
      if (code) this.join(from, code)
    } else if (req.op === 'leave') {
      if ((this.byPlayer.get(from.id)?.members.length ?? 0) > 1)
        this.system(from, 'You left the camp.')
      this.solo(from)
    }
  }

  /** Puts `player` in camp `code` (made if nobody's in it). False when it's full. */
  join(player: ServerPlayer, code: string): boolean {
    const was = this.byPlayer.get(player.id)
    if (was?.code === code) {
      this.sync(was)
      return true
    }
    const party = this.byCode.get(code) ?? { code, members: [] }
    if (party.members.length >= PARTY_MAX) {
      this.system(player, `That camp is full (${PARTY_MAX} people).`)
      if (!was) this.solo(player)
      return false
    }
    this.remove(player.id)
    party.members.push(player.id)
    this.byCode.set(code, party)
    this.byPlayer.set(player.id, party)
    if (party.members.length > 1) {
      const leader = this.host.players.get(party.members[0] ?? -1)
      for (const id of party.members) {
        const to = this.host.players.get(id)
        if (!to) continue
        const text =
          to === player
            ? `You joined ${leader ? `${leader.name}'s` : 'the'} camp.`
            : `${player.name} joined the camp.`
        this.system(to, text)
      }
      this.host.campJoined?.(player)
    }
    this.sync(party)
    return true
  }

  /** Leaves whatever camp they're in for a new one of their own. */
  solo(player: ServerPlayer): void {
    let code = makePartyCode(this.random)
    while (this.byCode.has(code)) code = makePartyCode(this.random)
    this.join(player, code)
  }

  /** A player left the game: out of their camp (which ends when it's empty). */
  forget(id: number): void {
    this.remove(id)
  }

  /** The others in `id`'s camp. */
  mates(id: number): number[] {
    return this.byPlayer.get(id)?.members.filter((m) => m !== id) ?? []
  }

  /** Who leads `id`'s camp (themselves when alone or first in). */
  leaderOf(id: number): number {
    return this.byPlayer.get(id)?.members[0] ?? id
  }

  codeOf(id: number): string | null {
    return this.byPlayer.get(id)?.code ?? null
  }

  /** Once a second: camps of two or more hear where everyone is. */
  step(): void {
    if (this.host.tick % TICK_RATE !== 0) return
    for (const party of this.byCode.values()) if (party.members.length > 1) this.sync(party)
  }

  private remove(id: number): void {
    const party = this.byPlayer.get(id)
    if (!party) return
    this.byPlayer.delete(id)
    party.members = party.members.filter((m) => m !== id)
    if (party.members.length === 0) {
      this.byCode.delete(party.code)
      return
    }
    const gone = this.host.players.get(id)
    for (const m of party.members) {
      const to = this.host.players.get(m)
      if (to && gone) this.system(to, `${gone.name} left the camp.`)
    }
    this.sync(party)
  }

  /** Tells everyone in the camp who's in it and where they are. */
  private sync(party: Party): void {
    const info: PartyInfo = {
      code: party.code,
      leader: party.members[0] ?? 0,
      members: party.members.flatMap((id) => {
        const p = this.host.players.get(id)
        if (!p) return []
        const { x, y, z } = p.state.pos
        const r = (v: number) => Math.round(v * 10) / 10
        return [{ id, name: p.name, x: r(x), y: r(y), z: r(z), alive: p.state.alive }]
      }),
    }
    const msg: ServerMessage = { type: ServerMsg.Social, social: { kind: 'party', party: info } }
    for (const id of party.members) {
      const to = this.host.players.get(id)
      if (to) this.host.sendTo(to, msg)
    }
  }

  private system(to: ServerPlayer, text: string): void {
    this.host.sendTo(to, { type: ServerMsg.Social, social: { kind: 'system', text } })
  }
}

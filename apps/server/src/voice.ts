import {
  cleanSignal,
  pairKey,
  RADIO_ITEM,
  RateLimit,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
  VOICE_NOISE,
  type VoiceCandidate,
  type VoiceEvent,
  type VoiceLevel,
  type VoicePeer,
  type VoiceRequest,
  validSignal,
  voiceLinks,
} from '@office-fps/shared'
import type { ServerPlayer } from './game.ts'

/** What the voice hub needs from the game. */
export interface VoiceHost {
  readonly players: ReadonlyMap<number, ServerPlayer>
  readonly tick: number
  sendTo(player: ServerPlayer, msg: ServerMessage): void
  readonly social: { isMuted(listener: number, speaker: number): boolean }
  readonly match: {
    readonly survivalDirector: {
      carries(player: ServerPlayer, item: string): boolean
      voiceNoise(player: ServerPlayer, metres: number): void
    } | null
  }
}

/** Who should be linked is worked out this often (ticks). */
export const VOICE_UPDATE_TICKS = TICK_RATE / 2

interface Voice {
  /** Handshake steps: a burst for the ICE candidates of a few links, then 8 a second. */
  signal: RateLimit
  /** Push-to-talk and loudness updates: 4 at once, then 4 a second. */
  talk: RateLimit
  talking: boolean
  /** The peers last sent to them, as "id" / "id:r" keys joined (to send only changes). */
  sent: string
  peers: VoicePeer[]
}

/**
 * Proximity voice, the server's part: it never touches sound. It decides who is linked with
 * whom (voice on, alive, within earshot or both carrying a radio, nobody muted, a few each), tells
 * each client, passes WebRTC handshake steps only between linked people, relays who's talking
 * and turns loud talking into noise the dead hear.
 */
export class VoiceHub {
  private readonly voices = new Map<number, Voice>()
  /** Current links ("lowId:highId"). */
  private links = new Set<string>()
  private readonly host: VoiceHost

  constructor(host: VoiceHost) {
    this.host = host
  }

  handle(from: ServerPlayer, req: VoiceRequest): void {
    if (!req || typeof req !== 'object' || from.zombie || from.bot || from.dummy) return
    const now = this.host.tick / TICK_RATE
    switch (req.kind) {
      case 'on': {
        if (req.on === true && !this.voices.has(from.id)) {
          this.voices.set(from.id, {
            signal: new RateLimit(40, 1 / 8),
            talk: new RateLimit(4, 1 / 4),
            talking: false,
            sent: '',
            peers: [],
          })
        } else if (req.on === false && this.voices.has(from.id)) {
          this.forget(from.id)
        } else return
        this.update()
        return
      }
      case 'signal': {
        const voice = this.voices.get(from.id)
        const to = this.host.players.get(req.to)
        if (!voice || typeof req.to !== 'number' || !to || !validSignal(req.signal)) return
        if (!this.links.has(pairKey(from.id, to.id))) return
        if (!voice.signal.take(now)) return
        this.send(to, { kind: 'signal', from: from.id, signal: cleanSignal(req.signal) })
        return
      }
      case 'talk': {
        const voice = this.voices.get(from.id)
        if (!voice || typeof req.talking !== 'boolean' || !voice.talk.take(now)) return
        const talking = req.talking && from.state.alive
        if (talking !== voice.talking) {
          voice.talking = talking
          for (const p of voice.peers) {
            const to = this.host.players.get(p.id)
            if (to) this.send(to, { kind: 'talk', from: from.id, talking })
          }
        }
        // Out loud the dead hear it (over the radio only the other end does, and that's far).
        const level = req.level
        if (talking && (level === 1 || level === 2 || level === 3)) {
          this.host.match.survivalDirector?.voiceNoise(from, VOICE_NOISE[level as VoiceLevel])
        }
        return
      }
    }
  }

  /** Every VOICE_UPDATE_TICKS: works out the links again (call each tick). */
  step(): void {
    if (this.host.tick % VOICE_UPDATE_TICKS === 0 && this.voices.size > 0) this.update()
  }

  /** Works out who is linked with whom and tells everyone whose links changed. */
  update(): void {
    const director = this.host.match.survivalDirector
    const people: VoiceCandidate[] = []
    for (const id of this.voices.keys()) {
      const p = this.host.players.get(id)
      // The dead go silent: no links until they're back on their feet.
      if (!p?.state.alive) continue
      const { x, y, z } = p.state.pos
      people.push({ id, x, y, z, radio: director?.carries(p, RADIO_ITEM) ?? false })
    }
    const blocked = new Set<string>()
    const social = this.host.social
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = (people[i] as VoiceCandidate).id
        const b = (people[j] as VoiceCandidate).id
        if (social.isMuted(a, b) || social.isMuted(b, a)) blocked.add(pairKey(a, b))
      }
    }
    const result = voiceLinks(people, this.links, blocked)
    const links = new Set<string>()
    for (const [id, peers] of result) for (const p of peers) links.add(pairKey(id, p.id))
    this.links = links
    for (const [id, voice] of this.voices) {
      const peers = result.get(id) ?? []
      const key = peers.map((p) => (p.radio ? `${p.id}:r` : `${p.id}`)).join(',')
      if (!peers.length && voice.talking) voice.talking = false
      if (key === voice.sent) continue
      voice.sent = key
      voice.peers = peers
      const player = this.host.players.get(id)
      if (player) this.send(player, { kind: 'peers', peers })
    }
  }

  /** Is voice on for player `id`? */
  isOn(id: number): boolean {
    return this.voices.has(id)
  }

  /** The people player `id` is linked with right now (tests, admin). */
  peersOf(id: number): readonly VoicePeer[] {
    return this.voices.get(id)?.peers ?? []
  }

  /** A player left (or switched voice off): drop them and their links. */
  forget(id: number): void {
    if (!this.voices.delete(id)) return
    for (const key of this.links) {
      const [a, b] = key.split(':').map(Number)
      if (a === id || b === id) this.links.delete(key)
    }
  }

  private send(to: ServerPlayer, voice: VoiceEvent): void {
    this.host.sendTo(to, { type: ServerMsg.Voice, voice })
  }
}

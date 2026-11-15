/**
 * Proximity voice: microphones talk to each other directly (WebRTC, peer to peer). The server
 * never carries sound, only decides who may talk to whom and passes the handshake along
 * (offers, answers, ICE candidates). Rules shared by the server and the client.
 */

/** Two people with voice on are connected within this (m)... */
export const VOICE_RANGE = 40
/** ...and stay connected until they are this far apart (so a link doesn't flap at the edge). */
export const VOICE_DROP = 48
/** Most voice links one player keeps open at once (the nearest win). */
export const MAX_VOICE_PEERS = 6
/** The item that lets two people who both carry one talk at any range (items.ts). */
export const RADIO_ITEM = 'radio'
/** Free public STUN only: no paid relay, so some strict NATs simply won't connect. */
export const VOICE_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

/** Loudness while talking, coarse: 0 quiet … 3 shouting. */
export type VoiceLevel = 0 | 1 | 2 | 3
/** How far each loudness carries to the dead (m). A whisper carries nowhere. */
export const VOICE_NOISE: Readonly<Record<VoiceLevel, number>> = { 0: 0, 1: 6, 2: 14, 3: 26 }

/** Longest session description passed along (characters); real ones are a few kB. */
export const SDP_MAX = 12000
/** Longest ICE candidate passed along (characters). */
export const ICE_MAX = 1000

/** One step of the WebRTC handshake. */
export type VoiceSignal =
  | { sdp: { type: 'offer' | 'answer'; sdp: string } }
  | {
      ice: {
        candidate: string
        sdpMid?: string | null
        sdpMLineIndex?: number | null
      }
    }

/** Client → server. */
export type VoiceRequest =
  /** Voice chat switched on (microphone granted) or off. */
  | { kind: 'on'; on: boolean }
  /** A handshake step for player `to` (only passed on if you two are linked). */
  | { kind: 'signal'; to: number; signal: VoiceSignal }
  /** Push-to-talk went down (with how loud you are) or up. */
  | { kind: 'talk'; talking: boolean; level?: VoiceLevel }

/** One person you should have a voice link with. */
export interface VoicePeer {
  id: number
  /** Linked by radio (both carry one, out of earshot): no direction, a crackle. */
  radio?: boolean
}

/** Server → client. */
export type VoiceEvent =
  /** Everyone you should be linked with now (open new links, close the rest). */
  | { kind: 'peers'; peers: VoicePeer[] }
  | { kind: 'signal'; from: number; signal: VoiceSignal }
  /** Somebody you're linked with started or stopped talking (the speaking mark). */
  | { kind: 'talk'; from: number; talking: boolean }

/** The one who sends the offer between two peers (the other answers): the lower id. */
export function voiceInitiator(a: number, b: number): boolean {
  return a < b
}

/** Loudness from a microphone's RMS level (0–1). */
export function voiceLevel(rms: number): VoiceLevel {
  if (rms > 0.25) return 3
  if (rms > 0.1) return 2
  if (rms > 0.03) return 1
  return 0
}

/** True if `signal` looks like a handshake step (anything could arrive from a client). */
export function validSignal(signal: unknown): signal is VoiceSignal {
  if (!signal || typeof signal !== 'object') return false
  const s = signal as Record<string, unknown>
  if (s.sdp !== undefined) {
    const sdp = s.sdp as Record<string, unknown> | null
    return (
      !!sdp &&
      typeof sdp === 'object' &&
      (sdp.type === 'offer' || sdp.type === 'answer') &&
      typeof sdp.sdp === 'string' &&
      sdp.sdp.length <= SDP_MAX
    )
  }
  if (s.ice !== undefined) {
    const ice = s.ice as Record<string, unknown> | null
    return (
      !!ice &&
      typeof ice === 'object' &&
      typeof ice.candidate === 'string' &&
      ice.candidate.length <= ICE_MAX &&
      (ice.sdpMid === undefined || ice.sdpMid === null || typeof ice.sdpMid === 'string') &&
      (ice.sdpMLineIndex === undefined ||
        ice.sdpMLineIndex === null ||
        typeof ice.sdpMLineIndex === 'number')
    )
  }
  return false
}

/** A trimmed copy holding only the handshake fields (nothing else a client slipped in). */
export function cleanSignal(signal: VoiceSignal): VoiceSignal {
  if ('sdp' in signal) return { sdp: { type: signal.sdp.type, sdp: signal.sdp.sdp } }
  const { candidate, sdpMid, sdpMLineIndex } = signal.ice
  return {
    ice: {
      candidate,
      ...(typeof sdpMid === 'string' ? { sdpMid } : {}),
      ...(typeof sdpMLineIndex === 'number' ? { sdpMLineIndex } : {}),
    },
  }
}

/** Somebody who could be linked: where they are and whether they carry a radio. */
export interface VoiceCandidate {
  id: number
  x: number
  y: number
  z: number
  radio: boolean
}

/**
 * Who should be linked with whom: every pair within VOICE_RANGE (or still within VOICE_DROP if
 * already linked), and every pair that both carry a radio; each person in at most `cap` links.
 * Links that already exist go first (no one gets dropped for a newcomer), then the nearest.
 * Always symmetric: if a links b, b links a.
 *
 * @param linked existing links, as "lowId:highId" keys
 * @param blocked pairs that must not link (somebody muted the other), same keys
 * @returns the links, as a map from each id to its peers (radio-only flagged)
 */
export function voiceLinks(
  people: readonly VoiceCandidate[],
  linked: ReadonlySet<string>,
  blocked: ReadonlySet<string> = new Set(),
  cap = MAX_VOICE_PEERS,
): Map<number, VoicePeer[]> {
  const pairs: { a: VoiceCandidate; b: VoiceCandidate; d: number; had: boolean; radio: boolean }[] =
    []
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i] as VoiceCandidate
      const b = people[j] as VoiceCandidate
      const key = pairKey(a.id, b.id)
      if (blocked.has(key)) continue
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
      const had = linked.has(key)
      const near = d <= (had ? VOICE_DROP : VOICE_RANGE)
      const radio = !near && a.radio && b.radio
      if (near || radio) pairs.push({ a, b, d, had, radio })
    }
  }
  // Kept links first, then by distance (radio links count as far: earshot wins a slot).
  pairs.sort((p, q) => Number(q.had) - Number(p.had) || p.d - q.d)
  const out = new Map<number, VoicePeer[]>()
  for (const p of people) out.set(p.id, [])
  for (const { a, b, radio } of pairs) {
    const la = out.get(a.id) as VoicePeer[]
    const lb = out.get(b.id) as VoicePeer[]
    if (la.length >= cap || lb.length >= cap) continue
    la.push(radio ? { id: b.id, radio: true } : { id: b.id })
    lb.push(radio ? { id: a.id, radio: true } : { id: a.id })
  }
  return out
}

/** The key of the pair a–b, the same whichever way round. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

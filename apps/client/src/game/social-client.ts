import {
  CHAT_MAX,
  type ChatChannel,
  filterProfanity,
  type ModeId,
  PING_LABELS,
  type PingKind,
  type SocialEvent,
  type SocialRequest,
  TEAMS,
} from '@office-fps/shared'
import type * as THREE from 'three'
import { ChatBox } from '../hud/chat.ts'
import { PingWheel } from '../hud/ping-wheel.ts'
import { SocialTags } from '../hud/social-tags.ts'

export interface SocialDeps {
  hudRoot: HTMLElement
  send: (req: SocialRequest) => void
  myId: () => number
  /** Name of player `id` (roster), if known. */
  nameOf: (id: number) => string | undefined
  /** Everyone's ids and names, to find whom `/mute name` means. */
  roster: () => Iterable<[number, { name: string }]>
  /** Where a speech bubble over `id` goes (null: not drawn). */
  headOf: (id: number) => THREE.Vector3 | null
  /** What the crosshair points at (world), for pings. */
  aimPoint: () => THREE.Vector3
  /** Player `id` waves (their avatar). */
  wave: (id: number) => void
  /** A ping arrived (also on the minimap where there is one). */
  onPing?: (kind: PingKind, at: { x: number; y: number; z: number }) => void
  /** A short sound: a ping, a chat line. */
  sound: (cue: 'ping' | 'chat') => void
  /** The chat line opened (true) or closed (false): the mouse is freed / taken back. */
  onChatOpen: (open: boolean) => void
}

export interface SocialSettings {
  chat: boolean
  chatFilter: boolean
  chatBubbles: boolean
}

/**
 * Talking without a microphone, on the client: the chat box, the ping wheel, ping markers and
 * speech bubbles, and the wave. The server decides who hears what (apps/server/src/social.ts);
 * this shows what arrives and sends what you do.
 */
export class SocialClient {
  readonly chat: ChatBox
  private readonly wheel: PingWheel
  private readonly tags: SocialTags
  private readonly deps: SocialDeps
  private settings: SocialSettings = { chat: true, chatFilter: true, chatBubbles: true }
  /** People you muted (the server stops their messages; kept here to show and toggle it). */
  private readonly muted = new Set<number>()
  private mode: ModeId = 'ffa'
  /** When the chat last moved out of the survival vitals' way (ms). */
  private placedAt = 0

  constructor(deps: SocialDeps) {
    this.deps = deps
    this.chat = new ChatBox(deps.hudRoot, CHAT_MAX)
    this.wheel = new PingWheel(deps.hudRoot)
    this.tags = new SocialTags(deps.hudRoot)
    this.chat.onSend = (text, channel) => this.typed(text, channel)
    this.chat.onClose = () => deps.onChatOpen(false)
    this.chat.onNameClick = (id) => this.setMuted(id, !this.muted.has(id))
  }

  /** The chat line is open or the ping wheel is held: the game shouldn't look or act. */
  get busy(): boolean {
    return this.chat.isOpen || this.wheel.active
  }

  get wheelActive(): boolean {
    return this.wheel.active
  }

  apply(settings: SocialSettings): void {
    this.settings = { ...settings }
    this.chat.setVisible(settings.chat)
  }

  setMode(mode: ModeId): void {
    this.mode = mode
    // Survival: nearby first, "all" on Tab. Team modes: all and team. Others: all only.
    this.chat.setChannels(
      mode === 'survival' ? ['nearby', 'all'] : TEAMS[mode] ? ['all', 'team'] : ['all'],
    )
  }

  isMuted(id: number): boolean {
    return this.muted.has(id)
  }

  /** Left the game: nothing carries over. */
  reset(): void {
    this.tags.clear()
    this.wheel.cancel()
    this.chat.close()
    this.muted.clear()
  }

  openChat(): void {
    if (!this.settings.chat || this.chat.isOpen) return
    this.wheel.cancel()
    this.chat.open()
    this.deps.onChatOpen(true)
  }

  pressPing(nowMs: number): void {
    if (!this.chat.isOpen) this.wheel.press(nowMs)
  }

  releasePing(): void {
    const kind = this.wheel.release()
    if (!kind) return
    const at = this.deps.aimPoint()
    this.deps.send({ kind: 'ping', ping: kind, x: at.x, y: at.y, z: at.z })
  }

  emote(): void {
    this.deps.send({ kind: 'emote' })
  }

  setMuted(id: number, muted: boolean): void {
    if (id === this.deps.myId()) return
    if (muted) this.muted.add(id)
    else this.muted.delete(id)
    this.deps.send({ kind: 'mute', id, muted })
  }

  /** A social message from the server. */
  onEvent(e: SocialEvent, nowMs: number): void {
    const me = this.deps.myId()
    switch (e.kind) {
      case 'chat': {
        if (this.muted.has(e.from) || !this.settings.chat) return
        const text = this.settings.chatFilter ? filterProfanity(e.text) : e.text
        this.chat.add({ from: e.from, name: e.name, text, channel: e.channel })
        if (e.from !== me) this.deps.sound('chat')
        // Bubbles only for what was said out loud nearby (survival) — not shouted across the map.
        if (this.settings.chatBubbles && e.channel === 'nearby' && e.from !== me)
          this.tags.say(e.from, text, nowMs)
        return
      }
      case 'ping': {
        if (this.muted.has(e.from)) return
        const who = e.from === me ? '' : (this.deps.nameOf(e.from) ?? '')
        this.tags.ping(e.ping, e, who, nowMs)
        this.deps.onPing?.(e.ping, e)
        this.deps.sound('ping')
        if (e.from !== me && this.settings.chat)
          this.chat.add({ from: null, text: `${who} pinged: ${PING_LABELS[e.ping]}`, quiet: true })
        return
      }
      case 'emote': {
        if (this.muted.has(e.from)) return
        if (e.from === me) {
          if (this.settings.chat) this.chat.add({ from: null, text: 'You wave.', quiet: true })
          return
        }
        this.deps.wave(e.from)
        if (this.settings.chatBubbles) this.tags.say(e.from, 'Friendly!', nowMs)
        const who = this.deps.nameOf(e.from) ?? 'Someone'
        if (this.settings.chat) this.chat.add({ from: null, text: `${who} waves.`, quiet: true })
        return
      }
      case 'system':
        this.chat.add({ from: null, text: e.text, quiet: true })
        return
    }
  }

  update(camera: THREE.Camera, nowMs: number): void {
    this.wheel.update(nowMs)
    if (nowMs - this.placedAt > 250) {
      this.placedAt = nowMs
      this.chat.stayAbove(
        this.mode === 'survival'
          ? this.deps.hudRoot.querySelector<HTMLElement>('.sv-vitals')
          : null,
      )
    }
    this.tags.update(camera, nowMs, this.deps.headOf)
  }

  /** A line typed into the chat: a command or something to say. */
  private typed(raw: string, channel: ChatChannel): void {
    const text = raw.trim()
    const command = /^\/(\w+)\s*(.*)$/.exec(text)
    if (!command) {
      this.deps.send({ kind: 'chat', text, channel })
      return
    }
    const [, verb = '', rest = ''] = command
    switch (verb.toLowerCase()) {
      case 'all':
      case 'a':
        if (rest) this.deps.send({ kind: 'chat', text: rest, channel: 'all' })
        return
      case 'team':
      case 't':
      case 'near':
      case 'n':
        if (rest)
          this.deps.send({
            kind: 'chat',
            text: rest,
            channel: this.mode === 'survival' ? 'nearby' : 'team',
          })
        return
      case 'mute':
      case 'unmute': {
        const id = this.find(rest)
        if (id === null) {
          this.chat.add({ from: null, text: `Nobody called "${rest}" here.`, quiet: true })
          return
        }
        this.setMuted(id, verb.toLowerCase() === 'mute')
        return
      }
      default:
        this.chat.add({
          from: null,
          text: 'Commands: /all text · /mute name · /unmute name. Tab switches channel.',
          quiet: true,
        })
    }
  }

  /** The player a typed name means: exact first, then the only one starting with it. */
  private find(name: string): number | null {
    const want = name.trim().toLowerCase()
    if (!want) return null
    const people = [...this.deps.roster()].filter(([id]) => id !== this.deps.myId())
    const exact = people.find(([, p]) => p.name.toLowerCase() === want)
    if (exact) return exact[0]
    const starts = people.filter(([, p]) => p.name.toLowerCase().startsWith(want))
    return starts.length === 1 ? (starts[0]?.[0] ?? null) : null
  }
}

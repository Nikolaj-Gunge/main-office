import {
  type ClientMessage,
  ClientMsg,
  decodeServerMessage,
  encodeClientMessage,
  PROTOCOL_VERSION,
  type PrimaryWeapon,
  type ServerMessage,
  ServerMsg,
  WeaponId,
  WS_PATH,
} from '@office-fps/shared'
import { NetSim } from './net-sim.ts'

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed'

export interface ConnectionEvents {
  onState?: (state: ConnectionState, reason?: string) => void
  onMessage?: (msg: ServerMessage) => void
}

const PING_INTERVAL_MS = 1000
const RECONNECT_DELAY_MS = 2000
/** Close codes where reconnecting won't help (see server connections.ts). */
const FATAL_CODES = new Set([4000, 4001])

/** WebSocket to the game server: binary codec, ping, traffic stats, net-sim, auto-reconnect. */
export class Connection {
  readonly sim = new NetSim()
  state: ConnectionState = 'idle'
  playerId = 0
  rtt = 0
  serverTickMs = 0
  /** Bytes per second, updated once a second. */
  bytesInPerSec = 0
  bytesOutPerSec = 0

  private ws: WebSocket | null = null
  private name = ''
  /** Primary weapon; kept up to date so reconnects spawn with the current choice. */
  primary: PrimaryWeapon = WeaponId.Rifle
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private bytesIn = 0
  private bytesOut = 0
  private readonly events: ConnectionEvents

  constructor(events: ConnectionEvents = {}) {
    this.events = events
    setInterval(() => {
      this.bytesInPerSec = this.bytesIn
      this.bytesOutPerSec = this.bytesOut
      this.bytesIn = 0
      this.bytesOut = 0
    }, 1000)
  }

  connect(name: string, primary: PrimaryWeapon): void {
    this.name = name
    this.primary = primary
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}${WS_PATH}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.setState('connecting')

    ws.addEventListener('open', () => {
      this.setState('open')
      this.send({
        type: ClientMsg.Hello,
        protocolVersion: PROTOCOL_VERSION,
        name: this.name,
        primary: this.primary,
      })
      this.sendPing()
      this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS)
    })

    ws.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return
      const data = event.data
      this.bytesIn += data.byteLength
      this.sim.delay('in', () => {
        if (this.ws !== ws) return // arrived after a reconnect
        this.handle(decodeServerMessage(data))
      })
    })

    ws.addEventListener('close', (event) => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      if (this.ws !== ws) return
      this.ws = null
      this.playerId = 0
      this.setState('closed', event.reason)
      if (!FATAL_CODES.has(event.code)) {
        setTimeout(() => this.connect(this.name, this.primary), RECONNECT_DELAY_MS)
      }
    })
  }

  send(msg: ClientMessage): void {
    const ws = this.ws
    if (ws?.readyState !== WebSocket.OPEN) return
    const bytes = encodeClientMessage(msg)
    this.bytesOut += bytes.byteLength
    this.sim.delay('out', () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(bytes)
    })
  }

  private handle(msg: ServerMessage): void {
    if (msg.type === ServerMsg.Welcome) this.playerId = msg.playerId
    if (msg.type === ServerMsg.Pong) {
      this.rtt = performance.now() - msg.clientTime
      this.serverTickMs = msg.tickMs
    }
    this.events.onMessage?.(msg)
  }

  private setState(state: ConnectionState, reason?: string): void {
    this.state = state
    this.events.onState?.(state, reason)
  }

  private sendPing(): void {
    this.send({ type: ClientMsg.Ping, clientTime: performance.now() })
  }
}

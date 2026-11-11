import {
  type ClientMessage,
  ClientMsg,
  decodeServerMessage,
  encodeClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  ServerMsg,
  WS_PATH,
} from '@office-fps/shared'

export type ConnectionState = 'connecting' | 'open' | 'closed'

export interface ConnectionEvents {
  onState?: (state: ConnectionState) => void
  onMessage?: (msg: ServerMessage) => void
  onRtt?: (rttMs: number) => void
}

const PING_INTERVAL_MS = 1000
const RECONNECT_DELAY_MS = 2000

/** WebSocket to the game server with binary codec, ping and auto-reconnect. */
export class Connection {
  private ws: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  playerId = 0
  rtt = 0

  constructor(
    private readonly name: string,
    private readonly events: ConnectionEvents = {},
  ) {}

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}${WS_PATH}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.events.onState?.('connecting')

    ws.addEventListener('open', () => {
      this.events.onState?.('open')
      this.send({ type: ClientMsg.Hello, protocolVersion: PROTOCOL_VERSION, name: this.name })
      this.sendPing()
      this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS)
    })

    ws.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return
      const msg = decodeServerMessage(event.data)
      if (msg.type === ServerMsg.Welcome) this.playerId = msg.playerId
      if (msg.type === ServerMsg.Pong) {
        this.rtt = performance.now() - msg.clientTime
        this.events.onRtt?.(this.rtt)
      }
      this.events.onMessage?.(msg)
    })

    ws.addEventListener('close', (event) => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      this.ws = null
      this.events.onState?.('closed')
      // 4000 = protocol mismatch: reconnecting won't help until the page reloads.
      if (event.code !== 4000) setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
    })
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeClientMessage(msg))
  }

  private sendPing(): void {
    this.send({ type: ClientMsg.Ping, clientTime: performance.now() })
  }
}

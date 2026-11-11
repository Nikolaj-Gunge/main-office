/**
 * Headless load-test bots: connect like real clients and wander around sending 60 inputs/s.
 *
 *   bun run bots                       # 20 bots against ws://localhost:3000/ws
 *   bun run bots --count 8 --url ws://host:3000/ws --seconds 60
 */
import {
  Button,
  type ClientMessage,
  ClientMsg,
  decodeServerMessage,
  encodeClientMessage,
  type InputCommand,
  PROTOCOL_VERSION,
  ServerMsg,
  TICK_RATE,
} from '@office-fps/shared'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback
}

const count = Number(arg('count', '20'))
const url = arg('url', 'ws://localhost:3000/ws')
const seconds = Number(arg('seconds', '0'))

const MOVES = [
  Button.Forward,
  Button.Forward | Button.Sprint,
  Button.Forward | Button.Left,
  Button.Forward | Button.Right,
  Button.Back,
  Button.Left,
  Button.Right,
  Button.Forward | Button.Crouch,
  0,
]

class Bot {
  private ws: WebSocket
  private seq = 1
  private buttons = 0
  private yaw = Math.random() * Math.PI * 2
  private turnRate = 0
  private nextChange = 0
  private timer: ReturnType<typeof setInterval> | null = null
  welcomed = false

  constructor(readonly index: number) {
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    this.ws.addEventListener('open', () => {
      this.send({ type: ClientMsg.Hello, protocolVersion: PROTOCOL_VERSION, name: `Bot ${index}` })
    })
    this.ws.addEventListener('message', (e) => {
      const msg = decodeServerMessage(e.data as ArrayBuffer)
      if (msg.type === ServerMsg.Welcome && !this.welcomed) {
        this.welcomed = true
        this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE)
      }
    })
    this.ws.addEventListener('close', (e) => {
      if (this.timer) clearInterval(this.timer)
      if (e.code !== 1000) console.log(`[bot ${index}] closed ${e.code} ${e.reason}`)
    })
  }

  private tick(): void {
    const now = performance.now()
    if (now > this.nextChange) {
      this.buttons = MOVES[Math.floor(Math.random() * MOVES.length)] ?? 0
      if (Math.random() < 0.15) this.buttons |= Button.Jump
      this.turnRate = (Math.random() - 0.5) * 4
      this.nextChange = now + 500 + Math.random() * 1500
    }
    this.yaw += this.turnRate / TICK_RATE
    const command: InputCommand = {
      seq: this.seq++,
      buttons: this.buttons,
      yaw: this.yaw,
      pitch: 0,
    }
    this.send({ type: ClientMsg.Input, commands: [command] })
    // Jump is edge-triggered: release it after one tick.
    this.buttons &= ~Button.Jump
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeClientMessage(msg))
  }

  close(): void {
    this.ws.close(1000)
  }
}

// Fail fast with a useful message instead of N identical "Failed to connect" lines.
const healthUrl = new URL('/healthz', url.replace(/^ws/, 'http'))
try {
  await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
} catch {
  console.error(`[bots] no game server at ${healthUrl.origin} — start it first with \`bun dev\``)
  process.exit(1)
}

console.log(`[bots] connecting ${count} bots to ${url}`)
const bots = Array.from({ length: count }, (_, i) => new Bot(i + 1))

const stop = () => {
  for (const bot of bots) bot.close()
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)
if (seconds > 0) setTimeout(stop, seconds * 1000)

/**
 * Headless load-test bots: connect like real clients and wander around making 60 inputs/s,
 * sent in batches like the game client (InputBatcher; `--batch N` overrides the batch size).
 *
 *   bun run bots                       # 20 bots against ws://localhost:3000/ws
 *   bun run bots --count 8 --url ws://host:3000/ws --seconds 60
 *   bun run bots --count 3 --shoot     # bots also shoot (badly) at the nearest player
 *   bun run bots --count 4 --batch 2   # the old batching, to compare message counts
 */
import {
  Button,
  type ClientMessage,
  ClientMsg,
  decodeServerMessage,
  encodeClientMessage,
  INPUT_BATCH_TICKS,
  InputBatcher,
  type InputCommand,
  PROTOCOL_VERSION,
  type RemotePlayerState,
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
const shoot = process.argv.includes('--shoot')
const batch = Number(arg('batch', String(INPUT_BATCH_TICKS)))

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
/** Aim error (radians) so shooting bots hit sometimes, not always. */
const AIM_ERROR = 0.05

class Bot {
  private readonly ws: WebSocket
  private readonly index: number
  private seq = 1
  private readonly batcher = new InputBatcher(batch)
  private buttons = 0
  private yaw = Math.random() * Math.PI * 2
  private pitch = 0
  private turnRate = 0
  private nextChange = 0
  private nextShot = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private self = { x: 0, y: 0, z: 0, alive: true }
  private others: RemotePlayerState[] = []
  welcomed = false

  constructor(index: number) {
    this.index = index
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    this.ws.addEventListener('open', () => {
      this.send({
        type: ClientMsg.Hello,
        protocolVersion: PROTOCOL_VERSION,
        name: `Bot ${index}`,
      })
    })
    this.ws.addEventListener('message', (e) => {
      const msg = decodeServerMessage(e.data as ArrayBuffer)
      if (msg.type === ServerMsg.Welcome && !this.welcomed) {
        this.welcomed = true
        this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE)
      }
      if (msg.type === ServerMsg.Snapshot) {
        this.lastTick = msg.tick
        this.others = msg.players
        if (msg.self) this.self = { ...msg.self.pos, alive: msg.self.alive }
      }
    })
    this.ws.addEventListener('close', (e) => {
      if (this.timer) clearInterval(this.timer)
      if (e.code !== 1000) console.log(`[bot ${this.index}] closed ${e.code} ${e.reason}`)
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

    let buttons = this.buttons
    if (shoot && this.self.alive && now > this.nextShot) {
      const target = this.nearestTarget()
      if (target) {
        const dx = target.x - this.self.x
        const dz = target.z - this.self.z
        const dy = target.y + 1.3 - (this.self.y + 1.65)
        this.yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * AIM_ERROR
        this.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (Math.random() - 0.5) * AIM_ERROR
        buttons = (buttons & ~Button.Sprint) | Button.Fire
        this.nextShot = now + 400 + Math.random() * 800
      }
    }

    const command: InputCommand = {
      seq: this.seq++,
      buttons,
      yaw: this.yaw,
      pitch: this.pitch,
      // Bots "see" the latest snapshot, no interpolation delay.
      viewTick: this.lastTick,
    }
    if (this.batcher.add(command)) {
      this.send({ type: ClientMsg.Input, commands: this.batcher.take() })
    }
    // Jump is edge-triggered: release it after one tick.
    this.buttons &= ~Button.Jump
  }

  private nearestTarget(): RemotePlayerState | null {
    let best: RemotePlayerState | null = null
    let bestD = 40 // only shoot within 40 m
    for (const p of this.others) {
      if (!p.alive) continue
      const d = Math.hypot(p.x - this.self.x, p.z - this.self.z)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
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

console.log(`[bots] connecting ${count} bots to ${url}${shoot ? ' (shooting)' : ''}`)
const bots = Array.from({ length: count }, (_, i) => new Bot(i + 1))

const stop = () => {
  for (const bot of bots) bot.close()
  setTimeout(() => process.exit(0), 200)
}
process.on('SIGINT', stop)
if (seconds > 0) setTimeout(stop, seconds * 1000)

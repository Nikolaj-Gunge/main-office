import {
  CLOSE_RESTING,
  ClientMsg,
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  ServerMsg,
} from '@office-fps/shared'
import type { RequestBudget } from './budget.ts'
import type { Game } from './game.ts'
import { MessageLimiter } from './rate-limit.ts'

/** The bit of a WebSocket a session needs; Bun's and Cloudflare's both fit. */
export interface SessionSocket {
  send(bytes: Uint8Array): void
  close(code: number, reason: string): void
}

export interface SessionOptions {
  /** Called once a message has been accepted as input (wakes an idle Cloudflare room). */
  onInput?: () => void
  /** Counts incoming messages; once it is resting, Hello is answered with CLOSE_RESTING. */
  budget?: RequestBudget | undefined
}

export interface Session {
  /** 0 until the Hello handshake succeeds. */
  readonly playerId: number
  message(raw: ArrayBuffer | Uint8Array): void
  close(code: number): void
}

/**
 * One client connection: Hello handshake, then routes its messages into the transport-agnostic
 * `Game`. Shared by the Bun server and the Cloudflare Durable Object.
 */
export function createSession(
  game: Game,
  socket: SessionSocket,
  getTickMs: () => number,
  options: SessionOptions = {},
): Session {
  const { onInput, budget } = options
  let playerId = 0
  const limiter = new MessageLimiter()

  return {
    get playerId() {
      return playerId
    },

    message(raw) {
      budget?.message()
      let msg: ReturnType<typeof decodeClientMessage>
      try {
        msg = decodeClientMessage(raw)
      } catch (err) {
        console.warn(`[ws] bad message from #${playerId}:`, (err as Error).message)
        return
      }
      if (!limiter.allow(msg.type, () => (playerId ? `#${playerId}` : 'a new connection'))) return

      switch (msg.type) {
        case ClientMsg.Hello: {
          if (playerId) return
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            socket.close(4000, 'Protocol version mismatch — reload the page')
            return
          }
          // People already playing keep going; only new arrivals are turned away.
          if (budget?.resting) {
            socket.close(CLOSE_RESTING, 'The servers are resting')
            return
          }
          const id = game.join(
            msg.name,
            { send: (bytes) => socket.send(bytes) },
            undefined,
            undefined,
            msg.appearance,
          )
          if (id === null) {
            socket.close(4001, 'Server full')
            return
          }
          playerId = id
          const name = game.players.get(id)?.name
          console.log(`[ws] #${id} "${name}" joined (${game.players.size} online)`)
          break
        }
        case ClientMsg.Input:
          if (!playerId) break
          game.handleInput(playerId, msg.commands)
          onInput?.()
          break
        case ClientMsg.SetDebug:
          if (playerId) game.setDebug(playerId, msg.flags)
          break
        case ClientMsg.Action:
          if (playerId) game.handleAction(playerId, msg.action)
          break
        case ClientMsg.Ping:
          if (playerId) game.reportPing(playerId, msg.rtt)
          socket.send(
            encodeServerMessage({
              type: ServerMsg.Pong,
              clientTime: msg.clientTime,
              serverTime: Date.now(),
              tickMs: getTickMs(),
            }),
          )
          break
      }
    },

    close(code) {
      if (!playerId) return
      const id = playerId
      playerId = 0
      game.leave(id)
      console.log(`[ws] #${id} left (${code}, ${game.players.size} online)`)
    },
  }
}

import {
  ClientMsg,
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  ServerMsg,
} from '@office-fps/shared'
import type { Game } from './game.ts'
import { accountOf } from './identity.ts'

/** The bit of a WebSocket a session needs; Bun's and Cloudflare's both fit. */
export interface SessionSocket {
  send(bytes: Uint8Array): void
  close(code: number, reason: string): void
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
  onInput?: () => void,
): Session {
  let playerId = 0
  /** Hello arrived and their save is being read. */
  let joining = false
  let closed = false

  /** Reads their character (if they have an account) and puts them in the game. */
  async function join(name: string, appearance: number | undefined, token: string | undefined) {
    let account = await accountOf(token)
    // Already playing in another tab: this one is a guest (one character, one body).
    for (const p of game.players.values()) if (account && p.account === account) account = null
    if (account) await game.saves.loadCharacter(account)
    if (closed) return
    const id = game.join(
      name,
      { send: (bytes) => socket.send(bytes), ...(account ? { account } : {}) },
      undefined,
      undefined,
      appearance,
    )
    if (id === null) {
      socket.close(4001, 'Server full')
      return
    }
    playerId = id
    const joined = game.players.get(id)?.name
    console.log(`[ws] #${id} "${joined}" joined (${game.players.size} online)`)
  }

  return {
    get playerId() {
      return playerId
    },

    message(raw) {
      let msg: ReturnType<typeof decodeClientMessage>
      try {
        msg = decodeClientMessage(raw)
      } catch (err) {
        console.warn(`[ws] bad message from #${playerId}:`, (err as Error).message)
        return
      }

      switch (msg.type) {
        case ClientMsg.Hello: {
          if (playerId || joining) return
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            socket.close(4000, 'Protocol version mismatch — reload the page')
            return
          }
          joining = true
          join(msg.name, msg.appearance, msg.token).catch((err) => {
            console.warn('[ws] join failed:', (err as Error).message)
            socket.close(1011, 'Could not join')
          })
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
      closed = true
      if (!playerId) return
      const id = playerId
      playerId = 0
      game.leave(id)
      console.log(`[ws] #${id} left (${code}, ${game.players.size} online)`)
    },
  }
}

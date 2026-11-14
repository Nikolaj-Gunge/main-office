import {
  CLOSE_RESTING,
  ClientMsg,
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  ServerMsg,
} from '@office-fps/shared'
import type { RequestBudget } from './budget.ts'
import { errorLog } from './errors.ts'
import type { Game } from './game.ts'
import { accountOf } from './identity.ts'
import { CLOSE_BANNED, moderationOf } from './moderation.ts'
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
  /** The client's address (bans), if the host knows it. */
  ip?: string | undefined
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
  const { onInput, budget, ip } = options
  let playerId = 0
  const moderation = moderationOf(game)
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
    moderation.connected(id, { ip, close: (code, reason) => socket.close(code, reason) })
    const joined = game.players.get(id)?.name
    console.log(`[ws] #${id} "${joined}" joined (${game.players.size} online)`)
  }
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

      try {
        switch (msg.type) {
          case ClientMsg.Hello: {
            if (playerId || joining) return
            if (msg.protocolVersion !== PROTOCOL_VERSION) {
              socket.close(4000, 'Protocol version mismatch — reload the page')
              return
            }
            // People already playing keep going; only new arrivals are turned away.
            if (budget?.resting) {
              socket.close(CLOSE_RESTING, 'The servers are resting')
              return
            }
            const ban = moderation.banned(msg.name, ip)
            if (ban) {
              socket.close(CLOSE_BANNED, `Banned: ${ban.reason}`.slice(0, 100))
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
          case ClientMsg.Social:
            if (playerId) game.handleSocial(playerId, msg.social)
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
      } catch (err) {
        // A message that breaks the game is logged (admin page) and dropped, not fatal.
        const name = game.players.get(playerId)?.name ?? '?'
        console.error(`[ws] message from #${playerId} failed:`, err)
        errorLog.add('session', err, `player #${playerId} "${name}"`)
      }
    },

    close(code) {
      closed = true
      if (!playerId) return
      const id = playerId
      playerId = 0
      moderation.disconnected(id)
      game.leave(id)
      console.log(`[ws] #${id} left (${code}, ${game.players.size} online)`)
    },
  }
}

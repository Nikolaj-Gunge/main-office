import {
  ClientMsg,
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  ServerMsg,
} from '@office-fps/shared'
import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { Game } from './game.ts'

export interface SocketData {
  /** 0 until the Hello handshake succeeds. */
  playerId: number
}

/** Adapts Bun WebSockets to the transport-agnostic `Game`. */
export function createConnections(game: Game, getTickMs: () => number) {
  const sockets = new Set<ServerWebSocket<SocketData>>()

  const handlers: WebSocketHandler<SocketData> = {
    open(ws) {
      sockets.add(ws)
    },

    message(ws, raw) {
      if (typeof raw === 'string') return

      let msg: ReturnType<typeof decodeClientMessage>
      try {
        msg = decodeClientMessage(raw)
      } catch (err) {
        console.warn(`[ws] bad message from #${ws.data.playerId}:`, (err as Error).message)
        return
      }

      switch (msg.type) {
        case ClientMsg.Hello: {
          if (ws.data.playerId) return
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            ws.close(4000, 'Protocol version mismatch — reload the page')
            return
          }
          const id = game.join(msg.name, { send: (bytes) => ws.send(bytes) }, msg.primary)
          if (id === null) {
            ws.close(4001, 'Server full')
            return
          }
          ws.data.playerId = id
          const name = game.players.get(id)?.name
          console.log(`[ws] #${id} "${name}" joined (${game.players.size} online)`)
          break
        }
        case ClientMsg.Input:
          if (ws.data.playerId) game.handleInput(ws.data.playerId, msg.commands)
          break
        case ClientMsg.SetLoadout:
          if (ws.data.playerId) game.setLoadout(ws.data.playerId, msg.primary)
          break
        case ClientMsg.SetDebug:
          if (ws.data.playerId) game.setDebug(ws.data.playerId, msg.flags)
          break
        case ClientMsg.Ping:
          if (ws.data.playerId) game.reportPing(ws.data.playerId, msg.rtt)
          ws.send(
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

    close(ws, code) {
      sockets.delete(ws)
      const id = ws.data.playerId
      if (!id) return
      game.leave(id)
      console.log(`[ws] #${id} left (${code}, ${game.players.size} online)`)
    },
  }

  return { handlers, count: () => sockets.size }
}

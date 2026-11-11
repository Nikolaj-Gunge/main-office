import {
  ClientMsg,
  decodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  ServerMsg,
  TICK_RATE,
} from '@office-fps/shared'
import type { ServerWebSocket, WebSocketHandler } from 'bun'

export interface SocketData {
  playerId: number
  name: string
}

const MAX_NAME_LENGTH = 16

export function createConnections(getTick: () => number) {
  let nextPlayerId = 1
  const sockets = new Set<ServerWebSocket<SocketData>>()

  const handlers: WebSocketHandler<SocketData> = {
    open(ws) {
      ws.data.playerId = nextPlayerId++
      sockets.add(ws)
      console.log(`[ws] #${ws.data.playerId} connected (${sockets.size} online)`)
    },

    message(ws, raw) {
      if (typeof raw === 'string') return

      let msg: ReturnType<typeof decodeClientMessage>
      try {
        msg = decodeClientMessage(raw)
      } catch (err) {
        console.warn(`[ws] #${ws.data.playerId} bad message:`, (err as Error).message)
        return
      }

      switch (msg.type) {
        case ClientMsg.Hello: {
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            ws.close(4000, 'Protocol version mismatch — reload the page')
            return
          }
          ws.data.name = msg.name.trim().slice(0, MAX_NAME_LENGTH) || `Player ${ws.data.playerId}`
          console.log(`[ws] #${ws.data.playerId} is "${ws.data.name}"`)
          ws.send(
            encodeServerMessage({
              type: ServerMsg.Welcome,
              playerId: ws.data.playerId,
              serverTick: getTick(),
              tickRate: TICK_RATE,
            }),
          )
          break
        }
        case ClientMsg.Ping:
          ws.send(
            encodeServerMessage({
              type: ServerMsg.Pong,
              clientTime: msg.clientTime,
              serverTime: Date.now(),
            }),
          )
          break
      }
    },

    close(ws, code) {
      sockets.delete(ws)
      console.log(`[ws] #${ws.data.playerId} disconnected (${code}, ${sockets.size} online)`)
    },
  }

  return { handlers, count: () => sockets.size }
}

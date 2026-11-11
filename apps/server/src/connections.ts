import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { Game } from './game.ts'
import { createSession, type Session } from './session.ts'

export interface SocketData {
  session: Session | null
}

/** Adapts Bun WebSockets to the transport-agnostic `Game`. */
export function createConnections(game: Game, getTickMs: () => number) {
  const sockets = new Set<ServerWebSocket<SocketData>>()

  const handlers: WebSocketHandler<SocketData> = {
    open(ws) {
      sockets.add(ws)
      ws.data.session = createSession(
        game,
        { send: (bytes) => ws.send(bytes), close: (code, reason) => ws.close(code, reason) },
        getTickMs,
      )
    },

    message(ws, raw) {
      if (typeof raw === 'string') return
      ws.data.session?.message(raw)
    },

    close(ws, code) {
      sockets.delete(ws)
      ws.data.session?.close(code)
    },
  }

  return { handlers, count: () => sockets.size }
}

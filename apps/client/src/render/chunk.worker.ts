import { type ChunkJob, ChunkMaker, type ChunkWorld, resultBuffers } from './chunk-geometry.ts'

/**
 * Builds forest chunk geometry off the main thread (see chunk-builder.ts): first the world, then
 * one job per message; every result goes back with its buffers transferred, not copied.
 */
type Message = { type: 'init'; world: ChunkWorld } | { type: 'job'; id: number; job: ChunkJob }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

let maker: ChunkMaker | null = null

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    maker = new ChunkMaker(m.world)
    return
  }
  if (!maker) return
  const result = maker.make(m.job)
  scope.postMessage({ id: m.id, result }, resultBuffers(result))
}

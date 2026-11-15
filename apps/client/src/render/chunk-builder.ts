import { type ChunkJob, ChunkMaker, type ChunkResult, type ChunkWorld } from './chunk-geometry.ts'

/**
 * Where forest chunks get built: in a Web Worker (chunk.worker.ts) so walking through the woods
 * doesn't cost the main thread its frames, or right here when there is no worker (tests, or
 * `?chunkworker=0`) or it fails. Either way results come back through take(), and now() builds
 * one on the spot when it's needed this very frame (the ground under your feet).
 */
export class ChunkBuilder {
  private readonly world: ChunkWorld
  private maker: ChunkMaker | null = null
  private worker: Worker | null = null
  private readonly ready: ChunkResult[] = []
  /** Jobs sent to the worker and not back yet (redone here if it dies). */
  private readonly out = new Map<number, ChunkJob>()
  private nextId = 1

  constructor(world: ChunkWorld, useWorker = defaultUseWorker()) {
    this.world = world
    if (!useWorker) return
    try {
      const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ id: number; result: ChunkResult }>) => {
        if (!this.out.delete(e.data.id)) return
        this.ready.push(e.data.result)
      }
      worker.onerror = (e) => {
        console.warn('[wilds] chunk worker failed, building on the main thread:', e.message)
        this.fallBack()
      }
      const { seed, terrain, pois, roads, lakes } = world
      worker.postMessage({ type: 'init', world: { seed, terrain, pois, roads, lakes } })
      this.worker = worker
    } catch (err) {
      console.warn('[wilds] no chunk worker:', err)
    }
  }

  /** Off the main thread? */
  get threaded(): boolean {
    return this.worker !== null
  }

  /** Jobs sent off and not back yet. */
  get inFlight(): number {
    return this.out.size
  }

  /** Queues a job; its result turns up in take() (at once without a worker). */
  request(job: ChunkJob): void {
    if (!this.worker) {
      this.ready.push(this.now(job))
      return
    }
    const id = this.nextId++
    this.out.set(id, job)
    this.worker.postMessage({ type: 'job', id, job })
  }

  /** Builds on this thread, now. */
  now(job: ChunkJob): ChunkResult {
    this.maker ??= new ChunkMaker(this.world)
    return this.maker.make(job)
  }

  /** Up to `max` results that came back, oldest first. */
  take(max = Number.POSITIVE_INFINITY): ChunkResult[] {
    return this.ready.splice(0, max)
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.out.clear()
    this.ready.length = 0
  }

  private fallBack(): void {
    this.worker?.terminate()
    this.worker = null
    const jobs = [...this.out.values()]
    this.out.clear()
    for (const job of jobs) this.ready.push(this.now(job))
  }
}

/** A worker in the browser unless `?chunkworker=0`; never under test. */
function defaultUseWorker(): boolean {
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('chunkworker') !== '0'
}

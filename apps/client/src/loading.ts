/**
 * Startup helpers: Rapier's WASM download with progress, and which map the server runs (so we
 * build that one straight away instead of building ours, joining and reloading into theirs).
 */

declare global {
  /** Set before initPhysics(): Rapier's loader hands us its URL (see vite.config.ts). */
  var __loadRapierWasm: ((url: URL, bytes: number) => Promise<Response>) | undefined
}

/** Fetches Rapier's WASM for it, reporting how much has arrived (0..1) as it streams in. */
export function trackPhysicsDownload(onProgress: (fraction: number) => void): void {
  globalThis.__loadRapierWasm = async (url, bytes) => {
    const response = await fetch(url) // the page preloads this URL (index.html)
    if (!response.ok || !response.body) return response
    let received = 0
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength
          onProgress(Math.min(1, received / bytes))
          controller.enqueue(chunk)
        },
      }),
    )
    // Still a streaming response: Rapier compiles it while it downloads.
    return new Response(counted, { headers: { 'Content-Type': 'application/wasm' } })
  }
}

/** The map the server is running, or null if it doesn't say within `timeoutMs` (offline). */
export async function serverMap(timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch('/healthz', { signal: AbortSignal.timeout(timeoutMs) })
    const body = (await response.json()) as { map?: unknown }
    return typeof body.map === 'string' ? body.map : null
  } catch {
    return null
  }
}

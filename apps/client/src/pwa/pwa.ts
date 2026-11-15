/**
 * The service worker's page side (sw.js does the caching): registers it in built games, and
 * says so when a new deploy is ready. Reloading gets the new build straight away (the page is
 * always fetched from the network first); the waiting worker then takes over quietly.
 */

/** How often a long session asks whether there is a new deploy (ms). */
const CHECK_MS = 20 * 60 * 1000

/** Off with ?nosw (and in dev, where Vite serves everything fresh anyway). */
export function wantsServiceWorker(search: string, prod: boolean): boolean {
  return prod && !new URLSearchParams(search).has('nosw') && 'serviceWorker' in navigator
}

/** Registers /sw.js; `onUpdate` runs once a new build has downloaded in the background. */
export async function registerServiceWorker(onUpdate: () => void): Promise<void> {
  const sw = navigator.serviceWorker
  let registration: ServiceWorkerRegistration
  try {
    registration = await sw.register('/sw.js')
  } catch (err) {
    console.warn('[sw] not registered:', (err as Error).message)
    return
  }
  // Left waiting from before (this page already came from the network): take over now.
  if (registration.waiting && sw.controller) registration.waiting.postMessage('skip-waiting')
  let told = false
  registration.addEventListener('updatefound', () => {
    const next = registration.installing
    next?.addEventListener('statechange', () => {
      // Installed next to one already running this page: a new deploy, not the first visit.
      if (next.state !== 'installed' || !sw.controller || told) return
      told = true
      void isThisBuild(next).then((current) => {
        // Reloaded into the new build already (e.g. after "The game was updated"): just let it
        // take over. Otherwise this page is the old one: offer the reload.
        if (current) next.postMessage('skip-waiting')
        else onUpdate()
      })
    })
  })
  setInterval(() => void registration.update().catch(() => {}), CHECK_MS)
}

/** Does this worker's build include the very script running this page? */
function isThisBuild(worker: ServiceWorker): Promise<boolean> {
  const mine = new URL(import.meta.url).pathname
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = (e) => resolve(Array.isArray(e.data) && e.data.includes(mine))
    worker.postMessage('files', [channel.port2])
    setTimeout(() => resolve(false), 3000)
  })
}

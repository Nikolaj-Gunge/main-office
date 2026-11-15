// The service worker (built into /sw.js by vite.config.ts serviceWorker()): a second visit
// loads from this device instead of the network.
//
//   /assets/* (hashed by Vite: the game, three.js, Rapier's WASM, the survival world chunk):
//     cache first. A new deploy gives changed files new names, so a cached one is never stale.
//   The page itself (index.html, /admin): network first, always asking the server (no-cache),
//     so a reload after "The game was updated" (close code 4000) always gets the new build and
//     with it the new asset names; the cached page is only for when the network is down.
//   Other files of ours (icons, manifest): from the cache at once, refreshed in the background.
//   Everything else (the game's WebSocket, /worlds, /healthz, /admin/api, other sites): untouched.
//
// BUILD and PRECACHE are filled in at build time. Every deploy changes BUILD, so the browser
// sees a new /sw.js, installs it next to the old one (downloading the new build's files ahead)
// and the page says "A new version is ready" (pwa.ts). The old caches go when it takes over.

const BUILD = '__BUILD__'
const PRECACHE = /** @type {string[]} */ (JSON.parse('__PRECACHE__'))
const ASSETS = `office-fps-assets-${BUILD}`
const PAGES = 'office-fps-pages'
const API = ['/ws', '/worlds', '/healthz', '/admin/api', '/sw.js']

/**
 * How a request is answered: 'asset' (cache first), 'page' (network first), 'static' (cache,
 * then refresh), or null (left to the network).
 * @param {{ method: string, mode: string, url: string }} req
 * @param {string} origin
 * @returns {'asset' | 'page' | 'static' | null}
 */
function route(req, origin) {
  if (req.method !== 'GET') return null
  const url = new URL(req.url)
  if (url.origin !== origin) return null
  if (API.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null
  if (url.pathname.startsWith('/assets/')) return 'asset'
  if (req.mode === 'navigate') return 'page'
  return 'static'
}

/** Caches to drop: every older build's. */
function stale(names) {
  return names.filter((n) => n.startsWith('office-fps-assets-') && n !== ASSETS)
}

self.__sw = { route, stale, BUILD, PRECACHE, ASSETS }

self.addEventListener('install', (event) => {
  // A new deploy: fetch its files now, so the refresh after the prompt is instant. A missing
  // file shouldn't stop the install: fetched again on demand. The very first visit doesn't:
  // the page is downloading the same files right then, and they're kept as they come.
  if (!self.registration?.active) return
  event.waitUntil(
    caches
      .open(ASSETS)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))),
  )
})

// The page's "Reload" on the prompt: take over now (pwa.ts reloads on controllerchange).
// And asked which files it has: a page that is already this build needs no prompt (pwa.ts).
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
  else if (event.data === 'files') event.ports[0]?.postMessage(PRECACHE)
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(stale(names).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const how = route(event.request, self.location.origin)
  if (how === 'asset') event.respondWith(cacheFirst(event.request))
  else if (how === 'page') event.respondWith(networkFirst(event.request))
  else if (how === 'static') event.respondWith(staleWhileRevalidate(event.request))
})

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone()).catch(() => {})
  return response
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES)
  try {
    const response = await fetch(request, { cache: 'no-cache' })
    if (response.ok) cache.put(request, response.clone()).catch(() => {})
    return response
  } catch (err) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw err
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(PAGES)
  const hit = await cache.match(request)
  const fresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {})
    return response
  })
  if (hit) {
    fresh.catch(() => {})
    return hit
  }
  return fresh
}

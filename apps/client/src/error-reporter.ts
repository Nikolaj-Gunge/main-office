// Sends this page's uncaught errors to the server (the admin page lists them). Deduplicated and
// rate-limited, so a page stuck throwing every frame sends a handful of reports, not thousands.

const ENDPOINT = '/admin/api/client-error'
/** Reports per page load at most, and the gap between two of them (ms). */
const MAX_REPORTS = 8
const MIN_GAP_MS = 2000

let sent = 0
let lastAt = -Infinity
const seen = new Set<string>()

function report(where: string, error: unknown, fallback: string): void {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : fallback).slice(
    0,
    300,
  )
  if (!message || seen.has(message)) return
  const now = performance.now()
  if (sent >= MAX_REPORTS || now - lastAt < MIN_GAP_MS) return
  seen.add(message)
  sent++
  lastAt = now
  const body = JSON.stringify({
    message,
    ...(error instanceof Error && error.stack ? { stack: error.stack.slice(0, 1500) } : {}),
    where,
    url: location.pathname + location.search,
    agent: navigator.userAgent.slice(0, 120),
  })
  // keepalive: still goes out if the error is the page going away.
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

/** Starts listening for uncaught errors and rejected promises (call once, early). */
export function installErrorReporter(): void {
  window.addEventListener('error', (e) =>
    report(
      e.filename ? `${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : 'window',
      e.error,
      String(e.message ?? 'Unknown error'),
    ),
  )
  window.addEventListener('unhandledrejection', (e) =>
    report('promise', e.reason, `Unhandled rejection: ${String(e.reason)}`),
  )
}

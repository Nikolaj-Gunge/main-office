declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare var __RAPIER_WASM__: WebAssembly.Module

interface Env {
  ROOM: DurableObjectNamespace
  /** Admin settings shared by every room version (see settings.ts). */
  SETTINGS: DurableObjectNamespace
  /** Secret: `bunx wrangler secret put ADMIN_PASSWORD`. Unset = admin page disabled. */
  ADMIN_PASSWORD?: string
  /**
   * Durable Object requests a day before new joins are turned away (at 95%). Unset = the free
   * plan's 100000; "0" = no limit (paid plan). Set in wrangler.jsonc `vars`.
   */
  FREE_REQUEST_LIMIT?: string
}

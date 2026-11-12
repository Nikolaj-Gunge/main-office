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
}

declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare var __RAPIER_WASM__: WebAssembly.Module

interface Env {
  ROOM: DurableObjectNamespace
  /** Secret: `bunx wrangler secret put ADMIN_PASSWORD`. Unset = admin page disabled. */
  ADMIN_PASSWORD?: string
}

declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare var __RAPIER_WASM__: WebAssembly.Module

interface Env {
  ROOM: DurableObjectNamespace
}

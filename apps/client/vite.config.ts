import { DEFAULT_SERVER_PORT, WS_PATH } from '@office-fps/shared'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${DEFAULT_SERVER_PORT}`, ws: true },
      '/healthz': `http://localhost:${DEFAULT_SERVER_PORT}`,
    },
  },
  build: {
    target: 'es2023',
    // three.js + Rapier's compat build (WASM inlined as base64): ~5 MB, ~1.8 MB gzipped.
    // Acceptable on the office network; PLAN.md phase 11 tracks switching to the binary WASM build.
    chunkSizeWarningLimit: 5500,
  },
})

import { DEFAULT_SERVER_PORT, WS_PATH } from '@office-fps/shared'
import { defineConfig } from 'vite'

// Override to run a second, isolated dev instance: CLIENT_PORT=5200 SERVER_PORT=3200.
const serverPort = Number(process.env.SERVER_PORT ?? DEFAULT_SERVER_PORT)
const clientPort = Number(process.env.CLIENT_PORT ?? 5173)

export default defineConfig({
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${serverPort}`, ws: true },
      '/healthz': `http://localhost:${serverPort}`,
      '/admin/api': `http://localhost:${serverPort}`,
    },
  },
  build: {
    target: 'es2023',
    // Two pages: the game and the admin page (/admin).
    rollupOptions: {
      input: {
        main: new URL('index.html', import.meta.url).pathname,
        admin: new URL('admin.html', import.meta.url).pathname,
      },
    },
    // three.js + Rapier's compat build (WASM inlined as base64): ~5 MB, ~1.8 MB gzipped.
    // Acceptable on the office network; PLAN.md phase 11 tracks switching to the binary WASM build.
    chunkSizeWarningLimit: 5500,
  },
})

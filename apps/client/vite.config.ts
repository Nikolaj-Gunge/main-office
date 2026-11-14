import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SERVER_PORT, WS_PATH } from '@office-fps/shared'
import { defineConfig, type Plugin } from 'vite'

// Override to run a second, isolated dev instance: CLIENT_PORT=5200 SERVER_PORT=3200.
const serverPort = Number(process.env.SERVER_PORT ?? DEFAULT_SERVER_PORT)
const clientPort = Number(process.env.CLIENT_PORT ?? 5173)

/**
 * Rapier's compat build inlines its 3 MB WASM as a base64 string (4 MB of JS that compresses
 * badly and must be decoded before it compiles). The server and the Cloudflare worker keep using
 * it as is; the browser gets the real `.wasm` file instead: the inlined copy is swapped for a
 * `new URL(…, import.meta.url)` to the file next to it, which Vite emits as a hashed asset.
 * Rapier fetches that URL itself and compiles it while it downloads (instantiateStreaming), and
 * the file stays cached across deploys (its hash only changes when Rapier does).
 */
const INLINED_WASM = /[A-Za-z_$][\w$]*\.toByteArray\("[A-Za-z0-9+/=]{1000,}"\)(\.buffer)?/
const RAPIER_MODULE = /rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/
const WASM_NAME = 'rapier_wasm3d_bg.wasm'

function rapierBinaryWasm(): Plugin {
  return {
    name: 'rapier-binary-wasm',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0] ?? id // dev adds ?v=…
      if (!RAPIER_MODULE.test(file)) return null
      if (!INLINED_WASM.test(code)) throw new Error(`inlined WASM not found in ${file}`)
      const bytes = statSync(join(dirname(file), WASM_NAME)).size
      // The page may fetch it itself to show progress (see src/loading.ts).
      const load = `((url) => globalThis.__loadRapierWasm?.(url, ${bytes}) ?? url)`
      const url = `new URL("./${WASM_NAME}", import.meta.url)`
      return { code: code.replace(INLINED_WASM, `${load}(${url})`), map: null }
    },
    // Start downloading it with the page, not once the game's script has run.
    transformIndexHtml: {
      order: 'post',
      handler(_, { bundle, filename }) {
        if (!bundle || !filename.endsWith('index.html')) return
        const wasm = Object.values(bundle).find(
          (file) =>
            file.type === 'asset' && file.originalFileNames.some((n) => n.endsWith(WASM_NAME)),
        )
        if (!wasm) return
        const attrs = { rel: 'preload', href: `/${wasm.fileName}`, as: 'fetch', crossorigin: '' }
        return [{ tag: 'link', attrs, injectTo: 'head' }]
      },
    },
  }
}

export default defineConfig({
  plugins: [rapierBinaryWasm()],
  // Pre-bundled dependencies skip plugin transforms: keep Rapier out so dev loads the .wasm too.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
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
    // Every browser we target has modulepreload: skip the polyfill (and its extra request).
    modulePreload: { polyfill: false },
    // The vendor chunk (three.js + Rapier's JS side) is ~850 kB before compression.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      // Two pages: the game and the admin page (/admin).
      input: {
        main: new URL('index.html', import.meta.url).pathname,
        admin: new URL('admin.html', import.meta.url).pathname,
      },
      // Three.js and Rapier in a chunk of their own: it keeps its hash (and stays cached) across
      // deploys that only change the game.
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules[\\/](three|@dimforge)[\\/]/ }],
        },
      },
    },
  },
})

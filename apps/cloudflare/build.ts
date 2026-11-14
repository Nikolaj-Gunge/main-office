/**
 * Builds the Cloudflare deployment into dist/: the client (served as static assets) and the
 * worker + room bundle. Wrangler then uploads both (`bun run deploy`).
 *
 * Rapier's compat build inlines its WASM as base64 and compiles it at runtime, which Workers
 * forbid. We cut that string out of the bundle and hand Rapier the precompiled module that
 * Wrangler uploads alongside (src/worker.ts). It also keeps the worker well under the free
 * plan's 3 MB size limit.
 */
import { copyFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BunPlugin } from 'bun'

const root = import.meta.dir
const dist = join(root, 'dist')
await rm(dist, { recursive: true, force: true })

// 1. Client → apps/client/dist (wrangler.jsonc points its assets there).
const client = Bun.spawnSync(['bun', 'run', 'build'], {
  cwd: join(root, '../client'),
  stdout: 'inherit',
  stderr: 'inherit',
})
if (client.exitCode !== 0) process.exit(client.exitCode ?? 1)
// Hashed files never change: browsers keep them for a year instead of asking again every load
// (Workers Assets default to max-age=0). index.html keeps the default and picks up new hashes.
await Bun.write(
  join(root, '../client/dist/_headers'),
  '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
)

// 2. Worker.
const INLINED_WASM = /[A-Za-z_$][\w$]*\.toByteArray\("[A-Za-z0-9+/=]{1000,}"\)(\.buffer)?/

const rapierWasm: BunPlugin = {
  name: 'rapier-precompiled-wasm',
  setup(build) {
    // Left as an import for Wrangler, which uploads the file as a compiled WASM module.
    build.onResolve({ filter: /^\.\/rapier\.wasm$/ }, ({ path }) => ({ path, external: true }))
    build.onLoad({ filter: /rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/ }, async ({ path }) => {
      const source = await Bun.file(path).text()
      if (!INLINED_WASM.test(source)) throw new Error(`inlined WASM not found in ${path}`)
      return { contents: source.replace(INLINED_WASM, 'globalThis.__RAPIER_WASM__'), loader: 'js' }
    })
  },
}

const result = await Bun.build({
  entrypoints: [join(root, 'src/worker.ts')],
  outdir: dist,
  target: 'browser',
  format: 'esm',
  minify: true,
  external: ['cloudflare:workers'],
  plugins: [rapierWasm],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// 3. The WASM itself, next to the worker. It is the exact file the base64 string encodes.
const rapierEntry = Bun.resolveSync(
  '@dimforge/rapier3d-compat',
  join(root, '../../packages/shared'),
)
await copyFile(join(dirname(rapierEntry), 'rapier_wasm3d_bg.wasm'), join(dist, 'rapier.wasm'))

const size = (await Bun.file(join(dist, 'worker.js')).size) / 1024
console.log(`[cloudflare] dist/worker.js ${size.toFixed(0)} KB + dist/rapier.wasm`)

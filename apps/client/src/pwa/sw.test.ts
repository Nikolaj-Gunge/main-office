import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/** Runs sw.js against a stub `self` (as vite.config.ts fills it in) and returns its helpers. */
function load(build = 'abc123', files = ['/assets/main-x.js']) {
  const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
    .replace('__BUILD__', build)
    .replace("'__PRECACHE__'", `'${JSON.stringify(files)}'`)
  const self: Record<string, unknown> = { addEventListener: () => {} }
  new Function('self', source)(self)
  return self.__sw as {
    route(req: { method: string; mode: string; url: string }, origin: string): string | null
    stale(names: string[]): string[]
    PRECACHE: string[]
    ASSETS: string
  }
}

const O = 'https://deadwood.example'
const get = (path: string, mode = 'cors') => ({ method: 'GET', mode, url: `${O}${path}` })

describe('service worker routes', () => {
  const sw = load()

  test('hashed assets are cache-first; the page is network-first', () => {
    expect(sw.route(get('/assets/vendor-C4IKMvDE.js'), O)).toBe('asset')
    expect(sw.route(get('/assets/rapier_wasm3d_bg-abc.wasm'), O)).toBe('asset')
    expect(sw.route(get('/', 'navigate'), O)).toBe('page')
    expect(sw.route(get('/?mute=1&map=deadwood', 'navigate'), O)).toBe('page')
    expect(sw.route(get('/manifest.webmanifest'), O)).toBe('static')
  })

  test('the server, other sites and writes are left alone', () => {
    expect(sw.route(get('/ws'), O)).toBeNull()
    expect(sw.route(get('/worlds'), O)).toBeNull()
    expect(sw.route(get('/healthz'), O)).toBeNull()
    expect(sw.route(get('/admin/api/state'), O)).toBeNull()
    expect(sw.route(get('/sw.js'), O)).toBeNull()
    expect(sw.route({ method: 'POST', mode: 'cors', url: `${O}/assets/x.js` }, O)).toBeNull()
    expect(
      sw.route({ method: 'GET', mode: 'cors', url: 'https://other.example/a.js' }, O),
    ).toBeNull()
  })

  test('a new build drops the old builds caches, not its own or the pages', () => {
    expect(sw.ASSETS).toBe('office-fps-assets-abc123')
    expect(
      sw.stale(['office-fps-assets-old1', 'office-fps-assets-abc123', 'office-fps-pages', 'x']),
    ).toEqual(['office-fps-assets-old1'])
    expect(sw.PRECACHE).toEqual(['/assets/main-x.js'])
  })
})

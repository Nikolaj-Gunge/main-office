import { resolve, sep } from 'node:path'

/**
 * Serves the built client. Unknown paths fall back to index.html; paths escaping the
 * dist directory are rejected.
 */
export async function serveStatic(root: string, pathname: string): Promise<Response> {
  const base = resolve(root)
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const target = resolve(base, `.${decoded}`)
  if (target !== base && !target.startsWith(base + sep)) {
    return new Response('Not found', { status: 404 })
  }

  const file = Bun.file(target === base ? resolve(base, 'index.html') : target)
  if (await file.exists()) return new Response(file)

  const index = Bun.file(resolve(base, 'index.html'))
  if (await index.exists()) return new Response(index)

  return new Response('Client not built — run `bun run build` (or use `bun dev`).', {
    status: 404,
  })
}

import { type Preview, previewFor, WORLD_PARAM, type WorldGlance } from '@office-fps/shared'

/**
 * Invite link previews (share-preview.ts): the game's page with its title and share tags
 * rewritten for one `/join?camp=…&world=…&from=…` link, so a chat unfurls it as "Join Ellen's
 * camp in Deadwood 2 · Night 23". HTMLRewriter escapes attribute values and text it writes.
 */
export function rewritePage(page: Response, preview: Preview, url: string): Response {
  const content = (value: string) => ({
    element(e: Element) {
      e.setAttribute('content', value)
    },
  })
  const headers = new Headers(page.headers)
  // Each link has its own words: never let a cache hand them to another link.
  headers.set('Cache-Control', 'no-store')
  headers.delete('ETag')
  headers.delete('Content-Length')
  return (
    new HTMLRewriter()
      .on('title', {
        element(e) {
          e.setInnerContent(preview.title)
        },
      })
      .on('meta[property="og:title"]', content(preview.title))
      .on('meta[name="twitter:title"]', content(preview.title))
      .on('meta[property="og:description"]', content(preview.description))
      .on('meta[name="twitter:description"]', content(preview.description))
      .on('meta[name="description"]', content(preview.description))
      // The picture from this host (index.html names the live one).
      .on('meta[property="og:image"]', content(`${new URL(url).origin}/og-image.png`))
      .on('meta[name="twitter:image"]', content(`${new URL(url).origin}/og-image.png`))
      .transform(new Response(page.body, { status: page.status, headers }))
  )
}

/**
 * The page for a join link: the static index.html (from `assets`) with the preview filled in.
 * `glance` is the world's head count and night from the Settings object (one cheap read; it
 * never wakes a sleeping room), or null when there's nothing to read.
 */
export async function joinPage(
  url: URL,
  assets: { fetch: (input: Request | string) => Promise<Response> },
  glance: (world: string) => Promise<WorldGlance | null>,
): Promise<Response> {
  const page = await assets.fetch(new URL('/', url).toString())
  if (!page.ok) return page
  const world = url.searchParams.get(WORLD_PARAM)
  let seen: WorldGlance | null = null
  if (world) {
    try {
      seen = await glance(world)
    } catch {
      // No glance, no night: the preview still names the camp.
    }
  }
  return rewritePage(page, previewFor(url.searchParams, seen), url.toString())
}

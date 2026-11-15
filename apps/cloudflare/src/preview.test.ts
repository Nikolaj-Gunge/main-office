import { describe, expect, test } from 'bun:test'
import { inviteLink, previewFor } from '@office-fps/shared'
import { joinPage, rewritePage } from './preview.ts'

const PAGE = `<!doctype html><html><head><title>Office FPS</title>
<meta name="description" content="static" />
<meta property="og:title" content="Join my camp in Deadwood" />
<meta property="og:description" content="static" />
<meta property="og:image" content="https://live/og-image.png" />
<meta name="twitter:title" content="x" />
<meta name="twitter:description" content="x" />
<meta name="twitter:image" content="https://live/og-image.png" />
</head><body></body></html>`

const query = (s: string) => new URLSearchParams(s)

describe('link previews', () => {
  test('a camp link names who sent it, the world and the night', () => {
    const p = previewFor(query('camp=ABCDEF&world=deadwood-2&from=Ellen'), {
      players: 4,
      night: 23,
    })
    expect(p.title).toBe("Join Ellen's camp in Deadwood 2 · Night 23")
    expect(p.description).toStartWith('4 by the fire tonight.')
  })

  test('no glance, private world, no name: still a sensible line', () => {
    expect(previewFor(query('camp=ABCDEF&world=p-abcdefgh'), null).title).toBe(
      'Join a camp in Deadwood',
    )
    expect(previewFor(query('world=deadwood-1'), { players: 1 }).title).toBe('Come to Deadwood 1')
    expect(previewFor(query('camp=ABCDEF&from=James'), null).title).toBe(
      "Join James' camp in Deadwood",
    )
  })

  test('names are cleaned: no markup, short', () => {
    const p = previewFor(
      query(`camp=ABCDEF&from=${encodeURIComponent('<b>"x"</b>'.repeat(9))}`),
      null,
    )
    expect(p.title).not.toContain('<')
    expect(p.title).not.toContain('"')
  })

  test('invite links go to /join with the world and sender', () => {
    expect(inviteLink('https://x.dev', 'ABCDEF', { world: 'deadwood-2', from: 'Ellen Voss' })).toBe(
      'https://x.dev/join?camp=ABCDEF&world=deadwood-2&from=Ellen+Voss',
    )
  })
})

describe('worker rewriting', () => {
  test('title, Open Graph and Twitter tags carry the preview (escaped)', async () => {
    const page = new Response(PAGE, { headers: { 'Content-Type': 'text/html', ETag: '"1"' } })
    const out = rewritePage(
      page,
      { title: 'Join A & B\'s camp "x"', description: 'One by the fire tonight.' },
      'https://host.dev/join?camp=ABCDEF',
    )
    const html = await out.text()
    expect(html).toContain('<title>Join A &amp; B')
    expect(html).toContain('property="og:title" content="Join A & B\'s camp &quot;x&quot;"')
    expect(html).toContain('name="twitter:description" content="One by the fire tonight."')
    expect(html).toContain('content="https://host.dev/og-image.png"')
    expect(html).not.toContain('static')
    expect(out.headers.get('Cache-Control')).toBe('no-store')
    expect(out.headers.get('ETag')).toBeNull()
  })

  test('joinPage reads one glance for the world and rewrites index.html', async () => {
    const asked: string[] = []
    const assets = {
      fetch: async (u: Request | string) => {
        asked.push(String(u))
        return new Response(PAGE, { headers: { 'Content-Type': 'text/html' } })
      },
    }
    const glances: string[] = []
    const res = await joinPage(
      new URL('https://host.dev/join?camp=ABCDEF&world=deadwood-1&from=Ellen'),
      assets,
      async (w) => {
        glances.push(w)
        return { players: 3, night: 7 }
      },
    )
    const html = await res.text()
    expect(asked).toEqual(['https://host.dev/'])
    expect(glances).toEqual(['deadwood-1'])
    expect(html).toContain("<title>Join Ellen's camp in Deadwood 1 · Night 7</title>")
  })

  test('no world: no Settings read at all', async () => {
    let reads = 0
    const res = await joinPage(
      new URL('https://host.dev/join?camp=ABCDEF'),
      { fetch: async () => new Response(PAGE) },
      async () => {
        reads++
        return null
      },
    )
    expect(await res.text()).toContain('<title>Join a camp in Deadwood</title>')
    expect(reads).toBe(0)
  })
})

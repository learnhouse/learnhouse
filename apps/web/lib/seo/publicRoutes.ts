/**
 * Public SEO/GEO URLs of an org host → the internal route handler that serves
 * them. Used by the proxy (which also attaches the resolved org). Pure, so the
 * URL map is unit tested.
 */
const FORMAT: Record<string, string> = { xml: 'rss', atom: 'atom', json: 'json' }

export function seoRouteFor(pathname: string, search = ''): string | null {
  const sort = new URLSearchParams(search).get('sort') === 'top' ? '&sort=top' : ''
  let m: RegExpMatchArray | null
  if (pathname === '/llms.txt') return '/api/seo/llms'
  if (pathname === '/llms-full.txt') return '/api/seo/llms?full=1'
  if (pathname === '/manifest.webmanifest') return '/api/seo/manifest'
  if (pathname === '/rss.xml') return '/api/seo/feed?kind=org&format=rss'
  if ((m = pathname.match(/^\/feed\.(xml|atom|json)$/))) return `/api/seo/feed?kind=org&format=${FORMAT[m[1]]}`
  if ((m = pathname.match(/^\/(courses|communities|live)\/feed\.(xml|atom|json)$/))) return `/api/seo/feed?kind=${m[1]}&format=${FORMAT[m[2]]}${sort}`
  if ((m = pathname.match(/^\/(community|newsletter)\/([^/]+)\/feed\.(xml|atom|json)$/)))
    return `/api/seo/feed?kind=${m[1]}&key=${encodeURIComponent(safeDecode(m[2]))}&format=${FORMAT[m[3]]}${sort}`
  if ((m = pathname.match(/^\/podcast\/([^/]+)\/feed(?:\.(xml|atom|json))?$/)))
    return `/api/seo/feed?kind=podcast&key=${encodeURIComponent(safeDecode(m[1]))}&format=${FORMAT[m[2] || 'xml']}`
  if ((m = pathname.match(/^\/([A-Za-z0-9-]{8,64})\.txt$/))) return `/api/seo/indexnow?key=${m[1]}`
  if (pathname.endsWith('.md') && parseMarkdownPath(pathname)) return `/api/seo/markdown?path=${encodeURIComponent(pathname)}`
  return null
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Which API resource a Markdown URL maps to, or null when the path has no
 * Markdown version.
 */
export function parseMarkdownPath(path: string): { type: string; key: string; sub?: string } | null {
  const p = path.replace(/\.md$/, '')
  let m = p.match(/^\/course\/([^/]+)\/activity\/([^/]+)$/)
  if (m) return { type: 'activity', key: safeDecode(m[1]), sub: safeDecode(m[2]) }
  m = p.match(/^\/community\/([^/]+)\/(\d+(?:-[a-z0-9-]*)?)$/)
  if (m) return { type: 'thread', key: safeDecode(m[1]), sub: m[2] }
  m = p.match(/^\/(course|path|podcast|community)\/([^/]+)$/)
  if (m) return { type: m[1], key: safeDecode(m[2]) }
  if (p === '/index' || p === '') return { type: 'home', key: '' }
  return null
}

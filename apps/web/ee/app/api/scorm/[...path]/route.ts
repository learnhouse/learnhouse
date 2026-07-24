import { NextRequest, NextResponse } from 'next/server'
import { getAPIUrl } from '@services/config/config'

/**
 * Proxy route for SCORM content
 * This serves SCORM content from the same origin as the frontend,
 * which is required for the SCORM API to work properly in iframes.
 *
 * Streams response bodies through (no buffering) and forwards Range
 * requests so large media inside packages stays seekable. Redirects from
 * the backend (presigned storage URLs for big media) are passed to the
 * browser instead of being followed here — only the entry documents need
 * to stay same-origin for the SCORM API bridge.
 */

const FORWARDED_REQUEST_HEADERS = ['range', 'if-none-match', 'if-modified-since']
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
]

/**
 * Whether `fetch` decompressed the upstream body underneath us.
 *
 * The API gzips every response over 1000 bytes, and undici's `fetch`
 * transparently decodes it — but leaves the upstream `content-length` (the
 * COMPRESSED size) on the response headers. Forwarding that header alongside
 * the decompressed body tells the browser to stop reading early, which
 * truncates every SCORM asset big enough to be gzipped: `modernizr.js` and
 * `scriptLoader.js` die on `Uncaught SyntaxError: Unexpected end of input`,
 * while files under the gzip threshold load fine.
 *
 * We do not forward `content-encoding` either, so the bytes and the headers
 * agree: no encoding, and a length only when it still describes the body.
 */
function bodyWasDecoded(response: Response): boolean {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  return !!encoding && encoding !== 'identity'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params
    const pathString = path.join('/')

    // Get query string from the request
    const queryString = request.nextUrl.search

    // Build the backend URL (include query string if present)
    const backendUrl = `${getAPIUrl()}scorm/${pathString}${queryString}`

    const forwardHeaders: Record<string, string> = {}
    for (const header of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(header)
      if (value) forwardHeaders[header] = value
    }

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: forwardHeaders,
      redirect: 'manual',
    })

    // Pass storage redirects (presigned media URLs) through to the browser
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) {
        return new NextResponse(null, {
          status: response.status,
          headers: {
            Location: location,
            'Cache-Control': response.headers.get('cache-control') ?? 'no-store',
          },
        })
      }
    }

    if (!response.ok) {
      return new NextResponse(null, { status: response.status })
    }

    const decoded = bodyWasDecoded(response)
    const headers = new Headers()
    for (const header of FORWARDED_RESPONSE_HEADERS) {
      // The compressed length describes bytes the browser will never see.
      // Dropping it lets the response go out chunked, which is correct at any
      // size; uncompressed responses (media, Range requests) keep theirs.
      if (header === 'content-length' && decoded) continue
      const value = response.headers.get(header)
      if (value) headers.set(header, value)
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream')
    }
    // A SCORM package is a fixed set of static files — the framework JS, CSS,
    // images and HTML pages the entry document pulls in as relative URLs, all
    // through this proxy. The old default of `no-store` meant the browser
    // cached none of them, so every SCO navigation and every revisit
    // re-downloaded the whole package over the two-hop path (browser → this
    // route → API), which is the bulk of why loading feels slow.
    //
    // These files don't change for the life of a package, so let the browser
    // keep them for the session. `private`, not `public`: SCORM content is
    // access-controlled upstream, so it must never land in a shared or CDN
    // cache. `must-revalidate` plus the ETag/Last-Modified this route already
    // forwards means a replaced package is picked up with a cheap 304 once the
    // window lapses, rather than served stale indefinitely. An upstream
    // Cache-Control still wins (the header is only set when absent).
    if (!headers.has('cache-control')) {
      headers.set('cache-control', 'private, max-age=3600, must-revalidate')
    }

    // Stream the body through (200 or 206 for Range responses)
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    console.error('SCORM proxy error:', error)
    return new NextResponse(null, { status: 500 })
  }
}

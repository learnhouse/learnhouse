import { NextRequest, NextResponse } from 'next/server'
import { getAPIUrl } from '@services/config/config'
import { bodyWasDecoded, canRecompress } from '../../../../services/scorm/proxyCompression'

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

    // Re-compress what the API had already compressed and `fetch` unpacked on
    // the way in, so the browser hop is not the one that carries the raw bytes.
    // `vary` goes on every response, compressed or not: the body now depends on
    // the request's accept-encoding, and a cache that missed that would serve
    // gzip to a client that cannot read it.
    headers.set('vary', 'accept-encoding')

    let body = response.body
    if (body && canRecompress(response, request.headers.get('accept-encoding'))) {
      body = body.pipeThrough(new CompressionStream('gzip'))
      headers.set('content-encoding', 'gzip')
      // The length of the plaintext no longer describes what goes out.
      headers.delete('content-length')
    }

    // Stream the body through (200 or 206 for Range responses)
    return new NextResponse(body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    console.error('SCORM proxy error:', error)
    return new NextResponse(null, { status: 500 })
  }
}

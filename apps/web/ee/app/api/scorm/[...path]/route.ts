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

    const headers = new Headers()
    for (const header of FORWARDED_RESPONSE_HEADERS) {
      const value = response.headers.get(header)
      if (value) headers.set(header, value)
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream')
    }
    if (!headers.has('cache-control')) {
      headers.set('cache-control', 'no-cache, no-store, must-revalidate')
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

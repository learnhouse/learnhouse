import { NextRequest, NextResponse } from 'next/server'
import { getServerAPIUrl } from '@services/config/config'
import { bodyWasDecoded, canRecompress } from '../../../../services/scorm/proxyCompression'
import { forwardedRequestHeaders } from '../../../../services/scorm/proxyHeaders'
import {
  SCORM_CONTENT_CSP,
  injectScormShim,
  normalizeHost,
  readLaunchTokenHost,
} from '../../../../services/scorm/scormShim'

/**
 * Proxy route for SCORM content: `/api/scorm/<activity>/t/<token>/content/<path>`.
 *
 * SCORM packages are untrusted HTML/JS. Every response from here is sandboxed
 * (CSP `sandbox` without `allow-same-origin`), so package code runs in an
 * opaque origin even when the URL is opened top-level, and it is authorized by
 * the launch token in the path, never by the viewer's session (no cookie or
 * Authorization header is forwarded). HTML documents get the SCORM API shim
 * injected, since a sandboxed document cannot reach the player's window.API.
 *
 * Streams other bodies through and forwards Range requests so large media stays
 * seekable. Redirects from the API (presigned storage URLs for big media) are
 * passed to the browser instead of being followed.
 */

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
]

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': SCORM_CONTENT_CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const ACTIVITY_SEGMENT = /^activity_[A-Za-z0-9-]+$/
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

function denied(status: number) {
  return new NextResponse(null, { status, headers: { ...SECURITY_HEADERS, 'cache-control': 'no-store' } })
}

function isHtml(contentType: string | null): boolean {
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  return type === 'text/html' || type === 'application/xhtml+xml'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params
    const [activity, marker, token, content, ...file] = path || []
    if (
      !activity || !ACTIVITY_SEGMENT.test(activity) ||
      marker !== 't' || !token || !TOKEN_SEGMENT.test(token) ||
      content !== 'content' || file.length === 0
    ) {
      return denied(404)
    }

    // A token is bound to the host its player ran on, which the API checked
    // belongs to the activity's org. Serving it on any other host would let
    // one tenant's package render under another tenant's origin.
    const tokenHost = readLaunchTokenHost(token)
    if (!tokenHost || tokenHost !== normalizeHost(request.headers.get('host'))) {
      return denied(404)
    }

    const pathString = path.map(encodeURIComponent).join('/')
    const backendUrl = `${getServerAPIUrl()}scorm/${pathString}${request.nextUrl.search}`

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: forwardedRequestHeaders(request.headers),
      redirect: 'manual',
    })

    // Pass storage redirects (presigned media URLs) through to the browser
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) {
        return new NextResponse(null, {
          status: response.status,
          headers: {
            ...SECURITY_HEADERS,
            Location: location,
            'Cache-Control': response.headers.get('cache-control') ?? 'no-store',
          },
        })
      }
    }

    if (!response.ok) {
      return denied(response.status)
    }

    const decoded = bodyWasDecoded(response)
    const html = isHtml(response.headers.get('content-type'))
    const headers = new Headers()
    for (const header of FORWARDED_RESPONSE_HEADERS) {
      // The compressed length describes bytes the browser will never see, and
      // an HTML body is rewritten below.
      if (header === 'content-length' && (decoded || html)) continue
      if (html && (header === 'etag' || header === 'last-modified')) continue
      const value = response.headers.get(header)
      if (value) headers.set(header, value)
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream')
    }
    // Package files are static and the token in the URL is stable for hours,
    // so the browser may keep them; the API sets the policy (HTML: no-store,
    // since it carries the learner's CMI seed). `private` always: access is
    // per launch and must never land in a shared cache.
    if (!headers.has('cache-control')) {
      headers.set('cache-control', html ? 'private, no-store' : 'private, max-age=3600, must-revalidate')
    }
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value)

    // The body depends on accept-encoding (re-compression below).
    headers.set('vary', 'accept-encoding')

    let body = response.body
    if (html) {
      const bytes = injectScormShim(new Uint8Array(await response.arrayBuffer()))
      body = new Response(bytes as BodyInit).body
      if (!canRecompress(response, request.headers.get('accept-encoding'))) {
        headers.set('content-length', String(bytes.length))
      }
    }

    // Re-compress what the API had already compressed and `fetch` unpacked on
    // the way in, so the browser hop is not the one that carries the raw bytes.
    if (body && canRecompress(response, request.headers.get('accept-encoding'))) {
      body = body.pipeThrough(new CompressionStream('gzip'))
      headers.set('content-encoding', 'gzip')
      headers.delete('content-length')
    }

    return new NextResponse(body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    console.error('SCORM proxy error:', error)
    return denied(500)
  }
}

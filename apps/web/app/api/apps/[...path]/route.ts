import { NextRequest, NextResponse } from 'next/server'
import { getBackendUrl } from '@services/config/config'

/**
 * Same-origin proxy for third-party app bundle assets.
 *
 * /api/apps/{app_uuid}/{sig}/assets/{path} → backend /api/v1/apps/...
 *
 * The iframe must be same-origin on subdomains AND custom domains so the
 * per-path frame headers in next.config.js apply. Authorization is the
 * HMAC-signed URL prefix validated by the backend — no cookies or tokens
 * are involved (sandboxed iframes send neither).
 *
 * The backend serves a strict CSP with `connect-src 'self'`; since only this
 * route knows the public origin, it narrows connect-src to the app's own
 * signed asset prefix so app code cannot reach any other same-origin URL.
 */

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  // Never forward browser credentials to the asset backend — assets are
  // authorized by the signed prefix alone.
  'cookie',
  'authorization',
])
const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
])

async function proxyAppAsset(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname // /api/apps/{app_uuid}/{sig}/assets/...
  const backendPath = path.replace(/^\/api\/apps\//, '/api/v1/apps/')
  const backendUrl = `${getBackendUrl().replace(/\/+$/, '')}${backendPath}`

  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })

  try {
    const backendResponse = await fetch(backendUrl, {
      method: request.method,
      headers,
    })

    const wasCompressed = backendResponse.headers.has('content-encoding')
    const responseHeaders = new Headers()
    backendResponse.headers.forEach((value, key) => {
      const lkey = key.toLowerCase()
      if (SKIP_RESPONSE_HEADERS.has(lkey)) return
      if (lkey === 'content-length' && wasCompressed) return
      responseHeaders.append(key, value)
    })

    // Narrow connect-src from 'self' (whole origin) to the app's own signed
    // asset prefix, now that the public origin is known.
    const csp = responseHeaders.get('content-security-policy')
    const appUuidMatch = path.match(/^\/api\/apps\/([A-Za-z0-9_-]+)\//)
    if (csp && appUuidMatch) {
      const origin = request.nextUrl.origin
      responseHeaders.set(
        'content-security-policy',
        csp.replace(
          "connect-src 'self'",
          `connect-src ${origin}/api/apps/${appUuidMatch[1]}/`
        )
      )
    }

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    })
  } catch (error: any) {
    console.error(`Failed to proxy app asset ${backendUrl}:`, error.message || error)
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return proxyAppAsset(request)
}

export async function HEAD(request: NextRequest) {
  return proxyAppAsset(request)
}

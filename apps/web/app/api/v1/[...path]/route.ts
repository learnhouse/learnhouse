import { NextRequest, NextResponse } from 'next/server'
import { getBackendUrl } from '@services/config/config'

// Allow large file uploads (videos, SCORM packages up to 5GB) to pass through
export const maxDuration = 3600 // 60 minutes
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Headers to skip when forwarding (hop-by-hop or Next.js internal)
const SKIP_REQUEST_HEADERS = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding'])
// Node.js fetch auto-decompresses responses, so we must strip content-encoding to
// avoid browsers trying to decompress an already-decompressed body.
const SKIP_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding'])

async function proxyToBackend(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname
  const search = request.nextUrl.search
  const backendUrl = `${getBackendUrl().replace(/\/+$/, '')}${path}${search}`

  // Forward all request headers except hop-by-hop ones
  const headers = new Headers()
  request.headers.forEach((value, key) => {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })

  // Forward request body as-is (no parsing/re-serializing)
  const body = request.method !== 'GET' && request.method !== 'HEAD'
    ? request.body
    : undefined

  const controller = new AbortController()
  // Just under maxDuration so large uploads (e.g. 5GB SCORM packages on slow
  // connections) can complete before the request is aborted with a 504.
  const timeoutId = setTimeout(() => controller.abort(), 3_590_000)

  try {
    const backendResponse = await fetch(backendUrl, {
      method: request.method,
      headers,
      body,
      // Pass redirects through to the browser instead of following them here.
      // Following them server-side broke both callers that rely on a 302:
      // the magic-link sign-in sets its auth cookies ON the redirect response,
      // and only the final hop's headers survive, so the user landed signed out;
      // and media streaming redirects to a presigned storage URL precisely so
      // the browser fetches bytes directly from object storage (see
      // _redirect_to_storage) — following it meant proxying every byte through
      // this server and discarding the redirect's caching headers.
      redirect: 'manual',
      // @ts-ignore — needed for streaming request bodies in Node.js
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit)
    clearTimeout(timeoutId)

    // Build response headers, forwarding everything from backend.
    // content-length is stripped only when the backend sent a compressed body
    // (content-encoding present), because Node.js decompresses it and the byte
    // count no longer matches. For uncompressed responses (including 206 range
    // responses used by video/audio players) content-length must be forwarded.
    const wasCompressed = backendResponse.headers.has('content-encoding')
    const responseHeaders = new Headers()
    backendResponse.headers.forEach((value, key) => {
      const lkey = key.toLowerCase()
      if (SKIP_RESPONSE_HEADERS.has(lkey)) return
      if (lkey === 'content-length' && wasCompressed) return
      // Set-Cookie is handled below: forEach collapses repeated headers into a
      // single comma-joined value, which would merge the access and refresh
      // cookies into one malformed header and set neither.
      if (lkey === 'set-cookie') return
      responseHeaders.append(key, value)
    })
    for (const cookie of backendResponse.headers.getSetCookie?.() ?? []) {
      responseHeaders.append('set-cookie', cookie)
    }

    // Stream the response body directly — no buffering
    // This preserves SSE streams, file downloads, and binary responses
    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    })
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 })
    }
    console.error(`Failed to proxy ${backendUrl}:`, error.message || error)
    return NextResponse.json(
      { error: 'Backend unavailable' },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest) {
  return proxyToBackend(request)
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request)
}

export async function PUT(request: NextRequest) {
  return proxyToBackend(request)
}

export async function PATCH(request: NextRequest) {
  return proxyToBackend(request)
}

export async function DELETE(request: NextRequest) {
  return proxyToBackend(request)
}

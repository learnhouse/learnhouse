import { NextRequest, NextResponse } from 'next/server'
import { getBackendUrl } from '@services/config/config'

// Allow large file uploads (videos, SCORM packages) to pass through
export const maxDuration = 300 // 5 minutes
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
  const timeoutId = setTimeout(() => controller.abort(), 290_000)

  try {
    const backendResponse = await fetch(backendUrl, {
      method: request.method,
      headers,
      body,
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
      responseHeaders.append(key, value)
    })

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

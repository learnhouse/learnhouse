import { API_BASE_URL } from '../../../lib/reference/config'

/**
 * Same-origin playground proxy. The LearnHouse API's CORS policy is pinned to
 * tenant domains, so the docs site cannot call it directly from the browser.
 *
 * Security posture:
 * - The upstream host is ALWAYS the server-configured API_BASE_URL; the client
 *   only supplies a path, validated against a strict /api/v1 regex → no SSRF.
 * - Only the Authorization header (bearer tokens the caller already holds) and
 *   a validated Content-Type are forwarded. Cookies never cross the proxy.
 * - No CORS headers are added, so third-party origins cannot ride it.
 */

export const dynamic = 'force-dynamic'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'application/x-www-form-urlencoded',
])
const PATH_RE = /^\/api\/v1\/[A-Za-z0-9\-._~/%?=&+@]*$/
const UPSTREAM_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function reject(status, detail) {
  return Response.json({ detail }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req) {
  let payload
  try {
    payload = await req.json()
  } catch {
    return reject(400, 'Invalid JSON payload')
  }

  const method = String(payload?.method || '').toUpperCase()
  const path = String(payload?.path || '')
  const contentType = payload?.contentType ? String(payload.contentType) : null

  if (!ALLOWED_METHODS.has(method)) return reject(400, 'Method not allowed')
  if (!PATH_RE.test(path)) return reject(400, 'Invalid path')

  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {}
  if (decoded.includes('..') || /^[a-z]+:/i.test(decoded) || path.startsWith('//')) {
    return reject(400, 'Invalid path')
  }

  const headers = {}
  const authorization = req.headers.get('authorization')
  if (authorization && /^Bearer\s+\S+$/i.test(authorization)) {
    headers.Authorization = authorization
  }

  let body
  if (payload?.body !== undefined && method !== 'GET' && method !== 'DELETE') {
    if (contentType === 'application/x-www-form-urlencoded') {
      headers['Content-Type'] = contentType
      body = new URLSearchParams(payload.body).toString()
    } else if (!contentType || ALLOWED_CONTENT_TYPES.has(contentType)) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(payload.body)
    } else {
      return reject(400, 'Unsupported content type')
    }
  }

  let upstream
  try {
    upstream = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (err) {
    const detail = err?.name === 'TimeoutError' ? 'Upstream timed out' : 'Upstream unreachable'
    return reject(502, detail)
  }

  const buffer = await upstream.arrayBuffer()
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    return reject(502, 'Upstream response too large for the playground')
  }

  return new Response(buffer, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

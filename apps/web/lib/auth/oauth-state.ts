// Server-only signing for the Google OAuth `state` parameter.
//
// The callback runs on the platform domain and may bounce the code to the
// custom domain that started the flow (returnOrigin). That target must come
// from state WE issued, not from whatever base64 an attacker puts in a crafted
// Google auth URL, so the state is `base64url(payload).base64url(hmac)`.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000

export interface OAuthStatePayload {
  // Client CSRF nonce, also stored in the LH_oauth_state cookie
  csrf: string
  callbackUrl?: string
  timestamp: number
  returnOrigin?: string
  nonce: string
  iat: number
}

function stateKey(): Buffer | null {
  const secret = process.env.LEARNHOUSE_GOOGLE_CLIENT_SECRET
  if (!secret) return null
  // Derived key, so the raw client secret never doubles as a MAC key.
  return createHmac('sha256', secret).update('learnhouse/google-oauth-state/v1').digest()
}

function sign(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('base64url')
}

export function signOAuthState(
  input: Pick<OAuthStatePayload, 'csrf' | 'callbackUrl' | 'timestamp' | 'returnOrigin'>,
): string | null {
  const key = stateKey()
  if (!key) return null
  const payload: OAuthStatePayload = {
    csrf: input.csrf,
    callbackUrl: input.callbackUrl,
    timestamp: input.timestamp,
    ...(input.returnOrigin ? { returnOrigin: input.returnOrigin } : {}),
    nonce: randomBytes(16).toString('base64url'),
    iat: Date.now(),
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body, key)}`
}

export function verifyOAuthState(state: unknown): OAuthStatePayload | null {
  if (typeof state !== 'string') return null
  const key = stateKey()
  if (!key) return null
  const dot = state.indexOf('.')
  if (dot <= 0 || dot !== state.lastIndexOf('.')) return null
  const body = state.slice(0, dot)
  const given = Buffer.from(state.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(body, key), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload
    if (typeof payload.iat !== 'number' || typeof payload.csrf !== 'string') return null
    const age = Date.now() - payload.iat
    if (age < 0 || age > OAUTH_STATE_MAX_AGE_MS) return null
    return payload
  } catch {
    return null
  }
}

// Origin the request came from: the Origin header, else the Host header.
// Returned as a URL host (hostname[:port]) for comparison.
export function requestOriginHost(request: NextRequest): string | null {
  const origin = request.headers.get('origin')
  if (origin && origin !== 'null') {
    try {
      return new URL(origin).host.toLowerCase()
    } catch {
      return null
    }
  }
  const host = request.headers.get('host')
  return host ? host.toLowerCase() : null
}

import { NextRequest, NextResponse } from 'next/server'
import { isSaaSMode } from '@lib/saas'
import { verifyTurnstile, clientIpFromHeaders } from '@lib/turnstile'

// Standalone Turnstile verification endpoint, used by the auth forms that call
// the backend DIRECTLY (login / forgot-password / reset-password) — they verify
// the token here first, then proceed. Signup has its own gateway
// (app/api/signup) that verifies inline. Returns { ok } (200 either way) so the
// client can branch. Turnstile is SaaS-only: outside SaaS (or with no secret)
// it always returns ok:true.
export async function POST(request: NextRequest) {
  // Off outside SaaS — never challenge OSS/self-hosted users.
  if (!(await isSaaSMode())) {
    return NextResponse.json({ ok: true })
  }

  let token: string | null = null
  try {
    const body = await request.json()
    token = body?.token ?? null
  } catch {
    // no/invalid body → treated as missing token below
  }

  const result = await verifyTurnstile(token, clientIpFromHeaders(request.headers))
  return NextResponse.json({ ok: result.ok, reason: result.reason })
}

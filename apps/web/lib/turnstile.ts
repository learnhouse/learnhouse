import 'server-only'

// Cloudflare Turnstile server-side verification.
//
// The widget on the client produces a short-lived, single-use token; we verify
// it here against Cloudflare's siteverify endpoint before allowing a sensitive
// action (signup, login, password reset). Secrets stay server-side.
//
// Design principle: Turnstile is OPTIONAL infrastructure. When TURNSTILE_SECRET_KEY
// is absent (local dev, self-hosted, OSS) verification is disabled and every
// action is allowed through — so the app degrades gracefully instead of locking
// everyone out. Gate the UI on isTurnstileEnabled() / the public site key.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** True when a server secret is configured, i.e. Turnstile is active. */
export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

export interface TurnstileResult {
  /** Whether the request should be allowed through. */
  ok: boolean
  /** Machine reason when not ok: 'disabled' never blocks. */
  reason?: 'missing_token' | 'verification_failed' | 'error'
  /** Raw Cloudflare error codes, for logging. */
  errorCodes?: string[]
}

/**
 * Verify a Turnstile token. Returns { ok: true } when Turnstile is disabled
 * (no secret) so callers can stay unconditional. When enabled, a missing or
 * invalid token yields ok: false with a reason.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  // Disabled deployment — allow through.
  if (!secret) return { ok: true }

  if (!token) return { ok: false, reason: 'missing_token' }

  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteIp) body.set('remoteip', remoteIp)

    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      // Never let a slow/unreachable Cloudflare hang the request forever.
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] }

    if (data.success) return { ok: true }
    return { ok: false, reason: 'verification_failed', errorCodes: data['error-codes'] }
  } catch (err) {
    console.error('[turnstile] siteverify request failed:', err)
    // Fail-OPEN on infrastructure errors: a Cloudflare outage shouldn't take
    // down our signup/login. Bot pressure is the exceptional case, not the norm.
    return { ok: true, reason: 'error' }
  }
}

/** Extract the best-effort client IP from a request for remoteip verification. */
export function clientIpFromHeaders(headers: Headers): string | undefined {
  const xff = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')
  if (!xff) return undefined
  return xff.split(',')[0]?.trim() || undefined
}

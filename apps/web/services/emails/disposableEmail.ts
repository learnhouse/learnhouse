import 'server-only'
import MailChecker from 'mailchecker'

// Disposable / throwaway email detection, used to keep fake signups out.
//
// Two layers:
//  1. `isDisposableEmail` — instant, offline check via mailchecker's bundled
//     list of known temp-mail domains. Zero latency, no network, always on.
//  2. `isDisposableEmailAPI` — slower AbstractAPI email-reputation lookup that
//     catches newer/obscure domains the bundled list misses. Cached per-domain
//     for 4 days. Only runs when ABSTRACT_EMAIL_API_KEY is set; otherwise it's
//     a no-op that returns false (never blocks).
//
// Both fail OPEN (return false = "allow") on any error or missing config, so a
// misconfiguration or third-party outage can never lock out real signups.

const ABSTRACT_URL = 'https://emailreputation.abstractapi.com/v1/'
const CACHE_TTL_MS = 4 * 24 * 60 * 60 * 1000 // 4 days

// domain -> { disposable, at }. Process-local; fine as a best-effort cache.
const domainCache = new Map<string, { disposable: boolean; at: number }>()

function domainOf(email: string): string {
  return email.split('@')[1]?.toLowerCase().trim() || ''
}

/** Fast, offline disposable check. Returns true for known throwaway domains. */
export function isDisposableEmail(email: string): boolean {
  try {
    // mailchecker.isValid === false means invalid OR disposable.
    return !MailChecker.isValid(email)
  } catch {
    return false
  }
}

/** AbstractAPI reputation check (cached). Returns false when unconfigured. */
export async function isDisposableEmailAPI(email: string): Promise<boolean> {
  const key = process.env.ABSTRACT_EMAIL_API_KEY
  if (!key) return false

  const domain = domainOf(email)
  if (!domain) return false

  const cached = domainCache.get(domain)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.disposable

  try {
    const url = `${ABSTRACT_URL}?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    const data = (await res.json()) as { email_quality?: { is_disposable?: boolean } }
    const disposable = Boolean(data?.email_quality?.is_disposable)
    domainCache.set(domain, { disposable, at: Date.now() })
    return disposable
  } catch (err) {
    console.error('[disposableEmail] AbstractAPI check failed:', err)
    return false
  }
}

export interface EmailValidationResult {
  ok: boolean
  reason?: 'disposable'
}

/**
 * Combined gate used by the signup route: offline check first (free), then the
 * API check only if the offline one passed. Blocks only when a layer positively
 * flags the address as disposable.
 */
export async function validateSignupEmail(email: string): Promise<EmailValidationResult> {
  if (isDisposableEmail(email)) return { ok: false, reason: 'disposable' }
  if (await isDisposableEmailAPI(email)) return { ok: false, reason: 'disposable' }
  return { ok: true }
}

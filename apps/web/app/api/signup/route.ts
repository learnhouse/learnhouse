import { NextRequest, NextResponse } from 'next/server'
import { getServerAPIUrl } from '@services/config/config'
import { isSaaSMode } from '@lib/saas'
import { verifyTurnstile, clientIpFromHeaders } from '@lib/turnstile'
import { validateSignupEmail } from '@services/emails/disposableEmail'
import { addContactWithLoops, sendLoopsEvent, LOOPS_SIGNED_USERS_GROUP } from '@services/emails/loops'

// Signup gateway. The client used to POST directly to the backend
// `users/{org_id}`; it now goes through here so we can run the "bells and
// whistles" server-side BEFORE creating the account — Cloudflare Turnstile
// verification and disposable-email rejection — and fire off the Loops
// marketing-contact sync AFTER a successful signup. Secrets never touch the
// client. All add-ons degrade gracefully when their keys are unset.

interface SignupBody {
  org_id?: string | number
  org_slug?: string
  email: string
  password: string
  username: string
  first_name?: string
  last_name?: string
  bio?: string
  turnstileToken?: string | null
  inviteCode?: string
}

export async function POST(request: NextRequest) {
  let body: SignupBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 })
  }

  const { email, org_id, turnstileToken, inviteCode, ...rest } = body

  if (!email || !rest.password || !rest.username) {
    return NextResponse.json({ detail: 'Missing required fields' }, { status: 400 })
  }

  // The anti-abuse add-ons (Turnstile, disposable-email, Loops) run ONLY on the
  // SaaS deployment. On OSS/self-hosted this route is a thin proxy to the
  // backend user-create endpoint, so signup keeps working everywhere.
  const saas = await isSaaSMode()

  if (saas) {
    // 1. Turnstile — allowed through automatically when no secret is set.
    const turnstile = await verifyTurnstile(turnstileToken, clientIpFromHeaders(request.headers))
    if (!turnstile.ok) {
      const detail =
        turnstile.reason === 'missing_token'
          ? 'Please complete the verification challenge.'
          : 'Verification failed. Please try again.'
      return NextResponse.json({ detail }, { status: 403 })
    }

    // 2. Disposable-email gate — offline check + optional AbstractAPI.
    const emailCheck = await validateSignupEmail(email)
    if (!emailCheck.ok) {
      return NextResponse.json(
        { detail: 'Please use a permanent email address — temporary/disposable addresses are not allowed.' },
        { status: 400 },
      )
    }
  }

  const base = getServerAPIUrl()

  // Resolve the org to create the account in. On real org subdomains the client
  // sends `org_id`. On the org-less apex it sends none, so we resolve the
  // instance DEFAULT org server-side — the UI never shows an org there.
  let resolvedOrgId: string | number | undefined = org_id
  let usedDefaultOrg = false
  if (!resolvedOrgId) {
    try {
      const instanceRes = await fetch(`${base}instance/info`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      const instance = await instanceRes.json()
      const defaultOrgSlug = instance?.default_org_slug
      if (!defaultOrgSlug) throw new Error('no default_org_slug')

      const orgRes = await fetch(`${base}orgs/slug/${defaultOrgSlug}`, { signal: AbortSignal.timeout(5000) })
      const org = await orgRes.json()
      if (!org?.id) throw new Error('default org not found')

      resolvedOrgId = org.id
      usedDefaultOrg = true
    } catch (err) {
      console.error('[signup] default org resolution failed:', err)
      return NextResponse.json({ detail: 'Signup is temporarily unavailable.' }, { status: 503 })
    }
  }

  // 3. Create the account on the backend. Forward only the user fields (never
  //    the turnstile token or invite code in the body).
  const backendBody = { email, org_id: resolvedOrgId, ...rest }
  const url = inviteCode
    ? `${base}users/${resolvedOrgId}/invite/${encodeURIComponent(inviteCode)}`
    : `${base}users/${resolvedOrgId}`

  let backendRes: Response
  try {
    backendRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendBody),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    console.error('[signup] backend request failed:', err)
    return NextResponse.json({ detail: 'Could not reach the signup service. Please try again.' }, { status: 502 })
  }

  const data = await backendRes.json().catch(() => ({}))

  // 4. On success, sync the marketing contact (SaaS-only, fire-and-forget).
  if (backendRes.ok && saas) {
    void addContactWithLoops(email, LOOPS_SIGNED_USERS_GROUP, {
      firstName: rest.first_name || '',
      lastName: rest.last_name || '',
    }).catch(() => {})
    void sendLoopsEvent(email, 'user_signed_up', {
      username: rest.username,
      has_org: Boolean(body.org_slug) && !usedDefaultOrg,
    }).catch(() => {})
  }

  return NextResponse.json(data, { status: backendRes.status })
}

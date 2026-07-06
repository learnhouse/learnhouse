import { NextRequest, NextResponse } from 'next/server'
import { getServerAPIUrl } from '@services/config/config'
import { isSaaSMode, isCustomDomainRequest } from '@lib/saas'
import { verifyTurnstile, clientIpFromHeaders } from '@lib/turnstile'
import { validateSignupEmail } from '@services/emails/disposableEmail'
import { addContactWithLoops, sendLoopsEvent, LOOPS_SIGNED_USERS_GROUP } from '@services/emails/loops'

// Signup gateway. Runs the anti-abuse add-ons (Turnstile, disposable-email)
// server-side BEFORE creating the account and fires the Loops marketing sync
// after — secrets never touch the client, and every add-on degrades gracefully
// when its key is unset (and only runs in SaaS mode).
//
// Account creation targets one of three backend endpoints, mirroring how the
// platform worked:
//   - org-less apex signup → POST /users/            (a standalone account, NOT
//     attached to any organization — the user creates/joins orgs later)
//   - org-subdomain signup → POST /users/{org_id}    (create + join that org)
//   - invite signup        → POST /users/{org_id}/invite/{code}
// The apex account is NOT linked to the instance default org.

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

  const { email, org_id, org_slug: _org_slug, turnstileToken, inviteCode, ...rest } = body

  if (!email || !rest.password || !rest.username) {
    return NextResponse.json({ detail: 'Missing required fields' }, { status: 400 })
  }

  // The anti-abuse add-ons run ONLY on the SaaS deployment. On OSS/self-hosted
  // this route is a thin proxy to the backend user-create endpoint.
  const saas = await isSaaSMode()

  if (saas) {
    // 1. Turnstile — allowed through automatically when no secret is set. Skipped
    // on org custom domains: the hostname-locked widget can't render there, so the
    // client sends no token and the challenge is disabled end-to-end (matches the
    // client widget + the /api/turnstile/verify route).
    if (!(await isCustomDomainRequest())) {
      const turnstile = await verifyTurnstile(turnstileToken, clientIpFromHeaders(request.headers))
      if (!turnstile.ok) {
        const detail =
          turnstile.reason === 'missing_token'
            ? 'Please complete the verification challenge.'
            : 'Verification failed. Please try again.'
        return NextResponse.json({ detail }, { status: 403 })
      }
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

  // The backend UserCreate body — account fields only; the org (if any) is in
  // the URL path, never the body.
  const backendBody = { email, ...rest }

  let url: string
  if (inviteCode) {
    if (!org_id) {
      return NextResponse.json({ detail: 'Invite signups require an organization.' }, { status: 400 })
    }
    url = `${base}users/${org_id}/invite/${encodeURIComponent(inviteCode)}`
  } else if (org_id) {
    // Org subdomain: create the account and join that org.
    url = `${base}users/${org_id}`
  } else {
    // Org-less apex: create a standalone account (POST /users/), unattached to
    // any org — exactly like the platform. The user creates their org next.
    url = `${base}users/`
  }

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

  // On success, sync the marketing contact (SaaS-only, fire-and-forget) — but
  // ONLY for ORG-LESS signups (learnhouse.io self-serve prospects). Members
  // signing up INTO an existing org (org_id present) are that org's learners,
  // not people we market to, so they are not added. Org admins are recorded
  // separately when they create/administer an org (see /api/loops/admin).
  if (backendRes.ok && saas && !org_id) {
    void addContactWithLoops(email, LOOPS_SIGNED_USERS_GROUP, {
      firstName: rest.first_name || '',
      lastName: rest.last_name || '',
    }).catch(() => {})
    void sendLoopsEvent(email, 'user_signed_up', {
      username: rest.username,
      has_org: false,
    }).catch(() => {})
  }

  return NextResponse.json(data, { status: backendRes.status })
}

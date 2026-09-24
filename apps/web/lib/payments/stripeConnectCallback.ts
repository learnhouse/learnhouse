// Pure helpers for the Stripe Connect OAuth callback page
// (app/payments/stripe/connect/oauth). Kept out of the component so the
// decisions that matter — when to submit, and what to submit — are testable.

export type StripeCallbackParams =
  | { kind: 'ready'; code: string; state: string; orgId: number }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }

/**
 * The org a Connect `state` was issued for.
 *
 * The API signs the state as a JWT whose payload carries `org_id`; the page only
 * reads it to route the request (the API re-checks it against the signature).
 * Links issued before that change carry the plain `org_id=<id>` form.
 */
export function orgIdFromConnectState(state: string): number | null {
  const legacy = /^org_id=(\d+)$/.exec(state)
  if (legacy) return Number(legacy[1])

  const payload = state.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const orgId = JSON.parse(atob(padded))?.org_id
    return Number.isInteger(orgId) && orgId > 0 ? orgId : null
  } catch {
    return null
  }
}

export function readStripeCallbackParams(params: URLSearchParams): StripeCallbackParams {
  // Stripe sends the admin back with `error` (e.g. access_denied) and no code
  // when they cancel on its authorization screen.
  if (params.get('error')) return { kind: 'cancelled' }

  const code = params.get('code')
  const state = params.get('state')
  const orgId = state ? orgIdFromConnectState(state) : null
  if (!code || !state || !orgId) return { kind: 'invalid' }
  return { kind: 'ready', code, state, orgId }
}

export type StripeCallbackStep = 'wait' | 'login' | 'submit'

/**
 * What the page should do given the session.
 *
 * Stripe's authorization code is single-use, and exchanging it again makes
 * Stripe revoke the connection it just granted. So the code is submitted
 * exactly once, and only with a signed-in session: a request sent while the
 * session is still loading reaches the API anonymously, is refused, and would
 * have spent the code for nothing.
 */
export function stripeCallbackStep(
  sessionStatus: 'loading' | 'authenticated' | 'unauthenticated' | undefined,
  accessToken: string | undefined,
  alreadySubmitted: boolean
): StripeCallbackStep {
  if (alreadySubmitted) return 'wait'
  if (sessionStatus === 'unauthenticated') return 'login'
  if (sessionStatus === 'authenticated' && accessToken) return 'submit'
  return 'wait'
}

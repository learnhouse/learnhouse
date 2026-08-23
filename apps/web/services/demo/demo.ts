import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

export type DemoStatus = {
  enabled: boolean
  slug: string
  state: string
  ready: boolean
  next_refresh_at: string | null
  refresh_minutes: number
}

/**
 * Whether this instance offers the shared demo organization.
 *
 * Public and unauthenticated — the onboarding page calls it before the visitor
 * has done anything, and a failure here must never block org creation, so
 * callers treat any error as "no demo available".
 */
export async function getDemoStatus(): Promise<DemoStatus | null> {
  try {
    const result = await fetch(`${getAPIUrl()}demo/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!result.ok) return null
    return (await result.json()) as DemoStatus
  } catch {
    return null
  }
}

/**
 * Join the signed-in user to the demo organization as an admin.
 *
 * Idempotent: a returning visitor already has a membership and simply gets the
 * slug back.
 */
export async function enterDemo(access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}demo/enter`,
    RequestBodyWithAuthHeader('POST', {}, null, access_token)
  )
  return await errorHandling(result)
}

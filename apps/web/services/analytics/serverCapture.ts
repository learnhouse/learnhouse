import 'server-only'
// Server-side PostHog capture, for events no browser sees (the Stripe webhook).
// Sends to PostHog's capture API with the project key the browser SDK uses.
// Keyed on the organization (distinct_id `org_<id>` plus the `organization`
// group), never on a person: no email, name or user id leaves the server.
// Never throws and never delays its caller for long: analytics must not be the
// reason a webhook fails.

const HOST = () => (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/+$/, '')

export async function captureOrgEvent(
  event: string,
  orgId: string | number,
  properties: Record<string, string | number | boolean | null | undefined> = {},
): Promise<boolean> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return false
  try {
    const res = await fetch(`${HOST()}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: `org_${orgId}`,
        properties: {
          ...properties,
          org_id: String(orgId),
          $groups: { organization: String(orgId) },
          $process_person_profile: false,
          source: 'server',
        },
        timestamp: new Date().toISOString(),
      }),
    })
    return res.ok
  } catch (err) {
    console.warn(`[analytics] ${event} not captured:`, err)
    return false
  }
}

/**
 * Paid conversion, from the Stripe webhook's checkout.session.completed: one
 * `plan_subscription_activated` per checkout, plus `trial_converted` when the
 * purchase ended a running trial. `applied` is the API's plan-write response,
 * which reports that and the org's age. No PII.
 */
export async function captureConversion(orgId: string | number, plan: string, subscription: any, applied: any): Promise<void> {
  const price = subscription?.items?.data?.[0]?.price
  const props = {
    plan,
    interval: price?.recurring?.interval ?? null,
    days_since_org_creation: typeof applied?.org_age_days === 'number' ? applied.org_age_days : null,
    was_trial: applied?.trial_converted === true,
  }
  await captureOrgEvent('plan_subscription_activated', orgId, props)
  if (props.was_trial) await captureOrgEvent('trial_converted', orgId, props)
}

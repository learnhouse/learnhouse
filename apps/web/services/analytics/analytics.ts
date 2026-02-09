import { getAPIUrl } from '@services/config/config'

const SESSION_KEY = 'lh_analytics_session_id'

function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, id)
  }
  return id
}

export async function trackEvent(
  eventName: string,
  orgId: number,
  properties: Record<string, unknown>,
  accessToken: string
): Promise<void> {
  try {
    const url = `${getAPIUrl()}analytics/events`
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        event_name: eventName,
        org_id: orgId,
        session_id: getSessionId(),
        properties,
      }),
      keepalive: true,
    })
  } catch {
    // Silently swallow — analytics should never break the app
  }
}

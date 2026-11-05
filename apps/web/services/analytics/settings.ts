import { getAPIUrl } from '@services/config/config'
import { apiFetch, errorHandling, RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

/** An org's analytics retention and privacy settings (org admins only). */
export interface AnalyticsSettings {
  retention_days: number
  track_anonymous: boolean
  collect_location: boolean
  exclude_staff: boolean
  retention_options: {
    standard: number[]
    extended: number[]
    /** Extended retention (over a year) and raw export need Enterprise. */
    extended_available: boolean
  }
}

export type AnalyticsSettingsUpdate = Partial<
  Pick<AnalyticsSettings, 'retention_days' | 'track_anonymous' | 'collect_location' | 'exclude_staff'>
>

export async function getAnalyticsSettings(orgId: number, accessToken: string): Promise<AnalyticsSettings> {
  return apiFetch(`${getAPIUrl()}analytics/settings?org_id=${orgId}`, accessToken)
}

export async function updateAnalyticsSettings(
  orgId: number,
  data: AnalyticsSettingsUpdate,
  accessToken: string,
): Promise<AnalyticsSettings> {
  const result = await fetch(
    `${getAPIUrl()}analytics/settings?org_id=${orgId}`,
    RequestBodyWithAuthHeader('PUT', data, null, accessToken),
  )
  return errorHandling(result)
}

/** Raw analytics events of the last `days` days as a CSV file (Enterprise). */
export async function exportAnalyticsEvents(orgId: number, days: number, accessToken: string): Promise<Blob> {
  const result = await fetch(
    `${getAPIUrl()}analytics/export/events?org_id=${orgId}&days=${days}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
      cache: 'no-store',
    },
  )
  if (!result.ok) await errorHandling(result)
  return result.blob()
}

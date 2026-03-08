import { getAPIUrl } from '@services/config/config'

export interface FeatureUsage {
  usage: number
  limit: number | 'unlimited'
  plan_limit?: number | 'unlimited'
  purchased?: number
  remaining: number | 'unlimited'
  limit_reached: boolean
}

export interface OrgUsageResponse {
  org_id: number
  plan: string
  oss_mode: boolean
  features: {
    courses: FeatureUsage
    members: FeatureUsage
    admin_seats: FeatureUsage
  }
}

/**
 * Fetch organization usage and limits from the backend.
 */
export async function getOrgUsage(
  orgId: number | string,
  accessToken: string
): Promise<OrgUsageResponse> {
  const response = await fetch(`${getAPIUrl()}orgs/${orgId}/usage`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch organization usage')
  }

  return response.json()
}

/**
 * SWR fetcher for organization usage.
 */
export async function orgUsageFetcher(
  url: string,
  accessToken: string
): Promise<OrgUsageResponse> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch organization usage')
  }

  return response.json()
}

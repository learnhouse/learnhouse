import { getAPIUrl } from '@services/config/config'

export interface FeatureUsage {
  usage: number
  limit: number | 'unlimited'
  plan_limit?: number | 'unlimited'
  purchased?: number
  remaining: number | 'unlimited'
  limit_reached: boolean
}

/**
 * Active-member usage. Deliberately NOT a `FeatureUsage`: this is a billed
 * dimension, not a quota, so the backend sends no `remaining`/`limit_reached`.
 * On paid plans the seats a plan includes are free whatever their holders do,
 * and each member beyond them who is active in the month is charged.
 */
export interface ActiveMembersUsage {
  usage: number
  limit: number | 'unlimited'
  overage_units: number
  overage_usd: number
}

export type DeploymentMode = 'saas' | 'ee' | 'oss'

export interface OrgUsageResponse {
  org_id: number
  plan: string
  mode: DeploymentMode
  features: {
    courses: FeatureUsage
    active_members: ActiveMembersUsage
    members: FeatureUsage
    admin_seats: FeatureUsage
  }
}

/** Full active-user summary from `GET /orgs/{id}/active-users`. Carries
 *  `members_beyond_included`, which the `/usage` payload omits. */
export interface ActiveUsersSummary {
  org_id: number
  plan: string
  year: number
  month: number
  active_users: number
  plan_limit: number
  members_beyond_included: number
  overage_units: number
  overage_usd: number
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

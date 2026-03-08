import { getAPIUrl } from '@services/config/config'

export interface OrgPackRead {
  id: number
  org_id: number
  pack_type: string
  pack_id: string
  quantity: number
  status: string
  activated_at: string
  cancelled_at: string | null
  platform_subscription_id: string
}

export interface PackCatalogItem {
  pack_id: string
  type: string
  quantity: number
  label: string
}

export interface OrgPacksResponse {
  active_packs: OrgPackRead[]
  available_packs: PackCatalogItem[]
}

export interface PackSummaryResponse {
  ai_credits: number
  member_seats: number
  active_pack_count: number
}

export async function getOrgPacks(
  orgId: number | string,
  accessToken: string
): Promise<OrgPacksResponse> {
  const response = await fetch(`${getAPIUrl()}orgs/${orgId}/packs`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch organization packs')
  }

  return response.json()
}

export async function getPacksSummary(
  orgId: number | string,
  accessToken: string
): Promise<PackSummaryResponse> {
  const response = await fetch(`${getAPIUrl()}orgs/${orgId}/packs/summary`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch pack summary')
  }

  return response.json()
}

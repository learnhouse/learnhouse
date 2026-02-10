import { getAPIUrl } from '@services/config/config'

export async function getSuperadminStatus(accessToken: string) {
  const res = await fetch(`${getAPIUrl()}ee/superadmin/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) return null
  return res.json()
}

export async function getAllOrganizations(
  accessToken: string,
  page: number = 1,
  limit: number = 20
) {
  const res = await fetch(
    `${getAPIUrl()}ee/superadmin/organizations?page=${page}&limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error('Failed to fetch organizations')
  return res.json()
}

export async function getGlobalAnalytics(
  accessToken: string,
  days: number = 30
) {
  const res = await fetch(
    `${getAPIUrl()}ee/superadmin/analytics/global?days=${days}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error('Failed to fetch global analytics')
  return res.json()
}

export async function getOrgAnalytics(
  accessToken: string,
  orgId: number,
  days: number = 30
) {
  const res = await fetch(
    `${getAPIUrl()}ee/superadmin/organizations/${orgId}/analytics?days=${days}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )
  if (!res.ok) throw new Error('Failed to fetch org analytics')
  return res.json()
}

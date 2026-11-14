import { cache } from 'react'
import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  fetchWithRetry,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function createNewOrganization(body: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}orgs/`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteOrganizationFromBackend(
  org_id: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

// Delete an organization from the UI. On SaaS this goes through the billing
// route, which also cancels the org's Stripe subscriptions so a deleted org
// stops being charged. Deployments without SaaS billing don't serve that route
// (404), so the backend is called directly there.
export async function deleteOrganization(org_id: number | string, access_token: string) {
  const result = await fetch('/api/billing/delete-org', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ orgId: org_id }),
  })
  if (result.status === 404) {
    return deleteOrganizationFromBackend(org_id, access_token)
  }
  return errorHandling(result)
}

// One org lookup per server request. The layout's metadata, the page's
// metadata and the page body each ask for the org, and every call is no-store,
// so a single page view used to hit /orgs/slug three or four times in a row.
// cache() dedupes within a request on the server; in the browser it's a
// pass-through. Keyed on primitives only, since callers pass a fresh `next`
// object each time (it was never sent anyway: no-store wins).
const fetchOrgBySlug = cache(async (org_slug: string, access_token?: string) => {
  const result = await fetchWithRetry(
    `${getAPIUrl()}orgs/slug/${org_slug}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
})

export async function getOrganizationContextInfo(
  org_slug: any,
  _next: any,
  access_token?: string
) {
  return fetchOrgBySlug(String(org_slug), access_token)
}

export async function getOrganizationContextInfoWithUUID(
  org_uuid: string,
  next: any,
  access_token?: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/uuid/${org_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

const fetchOrgBySlugWithoutCredentials = cache(async (org_slug: string) => {
  // Never use the Next.js fetch cache; the backend has its own Redis cache
  // which is invalidated on org config changes. Relying on Next's tag-based
  // revalidation was unreliable across pods and left users with stale data
  // for up to 60s after an admin changed settings like the signup method.
  const options: RequestInit = {
    method: 'GET',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    redirect: 'follow',
    cache: 'no-store',
  }
  const result = await fetchWithRetry(`${getAPIUrl()}orgs/slug/${org_slug}`, options)
  return errorHandling(result)
})

export async function getOrganizationContextInfoWithoutCredentials(
  org_slug: any,
  _next?: any
) {
  return fetchOrgBySlugWithoutCredentials(String(org_slug))
}

export function getOrganizationContextInfoNoAsync(
  org_slug: any,
  next: any,
  access_token: string
) {
  const result = fetch(
    `${getAPIUrl()}orgs/slug/${org_slug}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  return result
}

export async function updateUserRole(
  org_id: any,
  user_id: any,
  role_uuid: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/users/${user_id}/role/${role_uuid}`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateOrgLanding(
  org_id: any,
  landing_object: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/landing`,
    RequestBodyWithAuthHeader('PUT', landing_object, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateOrgFoldersSort(
  org_id: any,
  sort_mode: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/config/folders-sort?sort_mode=${sort_mode}`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function uploadLandingContent(
  org_uuid: any,
  content_file: File,
  access_token: string
) {
  const formData = new FormData()
  formData.append('content_file', content_file)
  
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_uuid}/landing/content`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function removeUserFromOrg(
  org_id: any,
  user_id: any,
  access_token: any
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/users/${user_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// Self-service: the current user leaves an org they belong to (no admin rights).
export async function leaveOrg(org_id: any, access_token: any) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/leave`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function removeUsersFromOrg(
  org_id: any,
  user_ids: number[],
  access_token: string
) {
  const params = new URLSearchParams()
  user_ids.forEach((id) => params.append('user_ids', id.toString()))
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/users/batch/remove?${params.toString()}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function removeAllUsersFromOrg(
  org_id: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/users/all`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function wipeOrgContent(org_id: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/content`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function joinOrg(
  args: {
    org_id: number
    user_id: string
    invite_code?: string
  },
  next: any,
  access_token?: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/join`,
    RequestBodyWithAuthHeader('POST', args, next, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// Enroll a member in one of the org's courses from an admin session.
export async function enrollMemberInCourse(
  org_id: number,
  user_id: number,
  course_uuid: string,
  access_token: any
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/users/${user_id}/enrollments/${encodeURIComponent(course_uuid)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  return getResponseMetadata(result)
}

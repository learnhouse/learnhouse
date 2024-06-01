import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function createNewOrganization(body: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}orgs/`,
    RequestBodyWithAuthHeader('POST', body, null,access_token)
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

export async function getOrganizationContextInfo(
  org_slug: any,
  next: any,
  access_token?: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/slug/${org_slug}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getOrganizationContextInfoWithId(
  org_id: any,
  next: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getOrganizationContextInfoWithoutCredentials(
  org_slug: any,
  next: any
) {
  let HeadersConfig = new Headers({ 'Content-Type': 'application/json' })
  let options: any = {
    method: 'GET',
    headers: HeadersConfig,
    redirect: 'follow',
    // Next.js
    next: next,
  }

  const result = await fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, options)
  const res = await errorHandling(result)
  return res
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

import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export async function getOrgDocSpaces(
  org_slug: string,
  next: any,
  access_token?: any,
  include_unpublished: boolean = false
) {
  const url = `${getAPIUrl()}docs/org_slug/${org_slug}/page/1/limit/100${include_unpublished ? '?include_unpublished=true' : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocSpace(
  docspace_uuid: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocSpaceMeta(
  docspace_uuid: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}/meta`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocSpaceBySlug(
  org_slug: string,
  docspace_slug: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/org_slug/${org_slug}/slug/${docspace_slug}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocSpaceMetaBySlug(
  org_slug: string,
  docspace_slug: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/org_slug/${org_slug}/slug/${docspace_slug}/meta`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createDocSpace(
  org_id: number,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/?org_id=${org_id}`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateDocSpace(
  docspace_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteDocSpace(
  docspace_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function setDefaultDocSpace(
  docspace_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}/set-default`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDefaultDocSpace(
  org_slug: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/org_slug/${org_slug}/default`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function searchDocPages(
  docspace_uuid: string,
  query: string,
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

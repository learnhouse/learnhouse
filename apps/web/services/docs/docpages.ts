import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export async function createDocPageInSection(
  docsection_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}/pages`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createDocPageInGroup(
  docgroup_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/groups/${docgroup_uuid}/pages`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocPage(
  docpage_uuid: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${docpage_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateDocPage(
  docpage_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${docpage_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteDocPage(
  docpage_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${docpage_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function moveDocPage(
  docpage_uuid: string,
  data: { docgroup_uuid: string | null; order?: number },
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${docpage_uuid}/move`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function reorderDocPages(
  docsection_uuid: string,
  page_ids: number[],
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}/pages/order`,
    RequestBodyWithAuthHeader('PUT', page_ids, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createSubpage(
  parentPageUuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${parentPageUuid}/subpages`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getSubpages(
  parentPageUuid: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${parentPageUuid}/subpages`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function reorderSubpages(
  parentPageUuid: string,
  pageIds: number[],
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/pages/${parentPageUuid}/subpages/order`,
    RequestBodyWithAuthHeader('PUT', pageIds, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}


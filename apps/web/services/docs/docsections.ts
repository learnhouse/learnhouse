import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export async function createDocSection(
  docspace_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}/sections`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocSections(
  docspace_uuid: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}/sections`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateDocSection(
  docsection_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteDocSection(
  docsection_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function reorderDocSections(
  docspace_uuid: string,
  section_ids: number[],
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/${docspace_uuid}/sections/order`,
    RequestBodyWithAuthHeader('PUT', section_ids, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function reorderSectionChildren(
  docsection_uuid: string,
  children: { type: 'page' | 'group'; id: number }[],
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}/children/order`,
    RequestBodyWithAuthHeader('PUT', children, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export async function createDocGroup(
  docsection_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}/groups`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getDocGroups(
  docsection_uuid: string,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}/groups`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateDocGroup(
  docgroup_uuid: string,
  data: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/groups/${docgroup_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteDocGroup(
  docgroup_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/groups/${docgroup_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function reorderDocGroups(
  docsection_uuid: string,
  group_ids: number[],
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}docs/sections/${docsection_uuid}/groups/order`,
    RequestBodyWithAuthHeader('PUT', group_ids, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

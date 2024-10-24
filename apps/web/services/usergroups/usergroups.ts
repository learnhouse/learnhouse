import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export async function getUserGroups(org_id: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/org/${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createUserGroup(body: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkUserToUserGroup(
  usergroup_id: any,
  user_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_users?user_ids=${user_id}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unLinkUserToUserGroup(
  usergroup_id: any,
  user_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_users?user_ids=${user_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateUserGroup(
  usergroup_id: number,
  access_token: string,
  data: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteUserGroup(
  usergroup_id: number,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkResourcesToUserGroup(
  usergroup_id: any,
  resource_uuids: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_resources?resource_uuids=${resource_uuids}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unLinkResourcesToUserGroup(
  usergroup_id: any,
  resource_uuids: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_resources?resource_uuids=${resource_uuids}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

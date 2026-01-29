import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export async function getUserGroups(org_id: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/org/${org_id}?org_id=${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createUserGroup(body: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/?org_id=${body.org_id}`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkUserToUserGroup(
  usergroup_id: any,
  user_id: any,
  org_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_users?user_ids=${user_id}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkUsersToUserGroup(
  usergroup_id: any,
  user_ids: number[],
  org_id: any,
  access_token: string
) {
  const userIdsParam = user_ids.join(',')
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_users?user_ids=${userIdsParam}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unLinkUserToUserGroup(
  usergroup_id: any,
  user_id: any,
  org_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_users?user_ids=${user_id}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unlinkUsersFromUserGroup(
  usergroup_id: any,
  user_ids: number[],
  org_id: any,
  access_token: string
) {
  const userIdsParam = user_ids.join(',')
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_users?user_ids=${userIdsParam}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateUserGroup(
  usergroup_id: number,
  org_id: any,
  access_token: string,
  data: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}?org_id=${org_id}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteUserGroup(
  usergroup_id: number,
  org_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}?org_id=${org_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkResourcesToUserGroup(
  usergroup_id: any,
  resource_uuids: any,
  org_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_resources?resource_uuids=${resource_uuids}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unLinkResourcesToUserGroup(
  usergroup_id: any,
  resource_uuids: any,
  org_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_resources?resource_uuids=${resource_uuids}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

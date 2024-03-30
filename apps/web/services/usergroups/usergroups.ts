import { getAPIUrl } from '@services/config/config'
import { RequestBody, getResponseMetadata } from '@services/utils/ts/requests'

export async function getUserGroups(org_id: any) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/org/${org_id}`,
    RequestBody('GET', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createUserGroup(body: any) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups`,
    RequestBody('POST', body, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkUserToUserGroup(usergroup_id: any, user_id: any) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_users?user_ids=${user_id}`,
    RequestBody('POST', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unLinkUserToUserGroup(usergroup_id: any, user_id: any) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_users?user_ids=${user_id}`,
    RequestBody('DELETE', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteUserGroup(usergroup_id: number) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}`,
    RequestBody('DELETE', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function linkResourcesToUserGroup(
  usergroup_id: any,
  resource_uuids: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/add_resources?resource_uuids=${resource_uuids}`,
    RequestBody('POST', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function unLinkResourcesToUserGroup(
  usergroup_id: any,
  resource_uuids: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/remove_resources?resource_uuids=${resource_uuids}`,
    RequestBody('DELETE', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

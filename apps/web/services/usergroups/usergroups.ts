import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandlingWithoutAuthRedirect,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/**
 * GET the org's usergroups as a plain list.
 *
 * Deliberately NOT `getResponseMetadata`: the ['usergroups', orgId] react-query
 * key is read by a dozen components, and react-query stores one entry per key
 * regardless of which observer's queryFn wrote it. While this returned the
 * metadata wrapper and other observers fetched the raw endpoint, whichever
 * component loaded last decided the cached shape — and the next one to read it
 * got an object where it expected a list (`usergroups.map is not a function`).
 * Throwing on a non-2xx means a failure surfaces as react-query `error` with
 * `data` left undefined instead of an error body posing as a result.
 *
 * And deliberately `errorHandlingWithoutAuthRedirect`, not `errorHandling`:
 * this endpoint is read from eleven surfaces, several of them learner-facing
 * (the org course list, the activity LockPopover). Under `getResponseMetadata`
 * a 401 here was swallowed entirely; routing it through `errorHandling` would
 * have fired authExpired and bounced the learner to /login — a brand-new
 * forced-logout trigger on pages that never had one, added while an
 * unexplained-logout investigation is still open. The shape fix does not need
 * the redirect, so it does not get it.
 */
export async function getUserGroups(org_id: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/org/${org_id}?org_id=${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandlingWithoutAuthRedirect(result)
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

export async function getUserGroupResources(
  usergroup_id: any,
  org_id: any,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}usergroups/${usergroup_id}/resources?org_id=${org_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
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

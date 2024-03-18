import { getAPIUrl } from '@services/config/config'
import { RequestBody, getResponseMetadata } from '@services/utils/ts/requests'

export async function createInviteCode(org_id: any) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/invites`,
    RequestBody('POST', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteInviteCode(
  org_id: any,
  org_invite_code_uuid: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/invites/${org_invite_code_uuid}`,
    RequestBody('DELETE', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function changeSignupMechanism(
  org_id: any,
  signup_mechanism: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/signup_mechanism?signup_mechanism=${signup_mechanism}`,
    RequestBody('PUT', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function validateInviteCode(org_id: any, invite_code: string) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/invites/code/${invite_code}`,
    RequestBody('GET', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function inviteBatchUsers(
  org_id: any,
  emails: string,
  invite_code_uuid: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${org_id}/invites/users/batch?emails=${emails}&invite_code_uuid=${invite_code_uuid}`,
    RequestBody('POST', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

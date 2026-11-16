import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, getResponseMetadata } from '@services/utils/ts/requests'

// Client for /api/v1/orgs/{org_id}/invitations and /invite-codes
// (apps/api/src/routers/orgs/invitations.py): email invitations with a role,
// groups, courses and an expiry, and shareable invite codes.

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'

export type RoleRef = { id: number; role_uuid: string; name: string }
export type GroupRef = { id: number; usergroup_uuid: string; name: string }
export type CourseRef = { course_uuid: string; name: string }
export type PersonRef = { id: number; user_uuid: string; username: string; name: string; avatar_image?: string | null }

export type Invitation = {
  invitation_uuid: string
  email: string
  status: InvitationStatus
  role: RoleRef | null
  usergroups: GroupRef[]
  courses: CourseRef[]
  message: string | null
  invited_by: PersonRef | null
  accepted_by: PersonRef | null
  created_at: string
  updated_at: string
  expires_at: string
  accepted_at: string | null
  last_sent_at: string | null
  email_sent: boolean
  send_count: number
  legacy: false
}

export type LegacyInvitation = {
  email: string
  status: 'pending'
  created_at: string | null
  email_sent: boolean
  legacy: true
}

export type InvitationList = {
  items: Invitation[]
  legacy: LegacyInvitation[]
  total: number
  page: number
  limit: number
  counts: Record<InvitationStatus, number>
}

export type RoleOption = {
  id: number
  role_uuid: string
  name: string
  description: string | null
  is_global: boolean
  grantable: boolean
  refusal: 'ADMIN_ONLY' | 'ABOVE_YOUR_ROLE' | 'ABOVE_TOKEN' | null
  occupies_seat: boolean
  code_allowed: boolean
}

export type CapacityBucket = { limit: number | null; used: number; pending: number }
export type Capacity = { plan: string | null; members: CapacityBucket; admin_seats: CapacityBucket }

export type InvitationOptions = {
  roles: RoleOption[]
  default_role_id: number
  capacity: Capacity
  expiry: { default_days: number; max_days: number }
  max_batch_size: number
}

export type CapacityRefusal = {
  code: 'MEMBER_LIMIT_REACHED' | 'ADMIN_SEAT_LIMIT_REACHED'
  message: string
  limit: number
  used: number
  pending: number
  requested: number
}

export type PreviewStatus = 'new' | 'pending' | 'member' | 'invalid'
export type InvitationPreview = {
  emails: { email: string; status: PreviewStatus }[]
  counts: Record<PreviewStatus, number>
  capacity: Capacity
  occupies_seat: boolean
  blocked: CapacityRefusal | null
}

export type InviteResultStatus =
  | 'sent'
  | 'resent'
  | 'email_failed'
  | 'already_member'
  | 'member_updated'
  | 'member_update_failed'
  | 'invalid_email'

export type InviteResult = { email: string; status: InviteResultStatus; invitation_uuid?: string; reason?: string | null }
export type InviteOutcome = { results: InviteResult[]; summary: Record<InviteResultStatus | 'total', number> }

export type InvitationSettings = {
  role_id: number
  usergroup_ids: number[]
  course_uuids: string[]
  message?: string | null
  expires_in_days: number
}

export type InviteCode = {
  invite_code: string
  invite_code_uuid: string
  created_at: string | null
  role: RoleRef | null
  usergroups: GroupRef[]
  courses: CourseRef[]
  usergroup_id?: number | null
  usergroup_name?: string | null
  max_uses: number | null
  uses: number | null
  expires_at: string | null
  status: 'active' | 'expired' | 'used_up' | 'revoked'
  legacy: boolean
}

export type InviteCodeSettings = {
  role_id: number
  usergroup_ids: number[]
  course_uuids: string[]
  max_uses: number | null
  expires_in_days: number | null
}

const base = (orgId: number) => `${getAPIUrl()}orgs/${orgId}`

async function call(method: string, url: string, body: unknown, token: string) {
  const res = await fetch(url, RequestBodyWithAuthHeader(method, body, null, token))
  return getResponseMetadata(res)
}

export function listInvitations(
  orgId: number,
  token: string,
  params: { status?: InvitationStatus | ''; q?: string; page?: number; limit?: number } = {}
) {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.q) qs.set('q', params.q)
  qs.set('page', String(params.page ?? 1))
  qs.set('limit', String(params.limit ?? 50))
  return call('GET', `${base(orgId)}/invitations?${qs.toString()}`, null, token)
}

export const getInvitationOptions = (orgId: number, token: string) => call('GET', `${base(orgId)}/invitations/options`, null, token)

export const previewInvitations = (
  orgId: number,
  body: { emails: string[]; role_id: number; update_existing_members: boolean },
  token: string
) => call('POST', `${base(orgId)}/invitations/preview`, body, token)

export const createInvitations = (
  orgId: number,
  body: InvitationSettings & { emails: string[]; update_existing_members: boolean },
  token: string
) => call('POST', `${base(orgId)}/invitations`, body, token)

export const updateInvitation = (orgId: number, uuid: string, body: Partial<InvitationSettings>, token: string) =>
  call('PATCH', `${base(orgId)}/invitations/${encodeURIComponent(uuid)}`, body, token)

export const resendInvitation = (orgId: number, uuid: string, token: string) =>
  call('POST', `${base(orgId)}/invitations/${encodeURIComponent(uuid)}/resend`, {}, token)

export const invitationLink = (orgId: number, uuid: string, token: string) =>
  call('POST', `${base(orgId)}/invitations/${encodeURIComponent(uuid)}/link`, null, token)

export const revokeInvitation = (orgId: number, uuid: string, token: string) =>
  call('POST', `${base(orgId)}/invitations/${encodeURIComponent(uuid)}/revoke`, null, token)

export const bulkInvitations = (orgId: number, action: 'resend' | 'revoke', uuids: string[], token: string) =>
  call('POST', `${base(orgId)}/invitations/bulk`, { action, invitation_uuids: uuids }, token)

export const listInviteCodes = (orgId: number, token: string) => call('GET', `${base(orgId)}/invite-codes`, null, token)

export const createInviteCodeV2 = (orgId: number, body: InviteCodeSettings, token: string) =>
  call('POST', `${base(orgId)}/invite-codes`, body, token)

export const updateInviteCode = (orgId: number, uuid: string, body: Partial<InviteCodeSettings>, token: string) =>
  call('PATCH', `${base(orgId)}/invite-codes/${encodeURIComponent(uuid)}`, body, token)

export const deleteInviteCodeV2 = (orgId: number, uuid: string, token: string) =>
  call('DELETE', `${base(orgId)}/invite-codes/${encodeURIComponent(uuid)}`, null, token)

// Splits pasted text on commas, semicolons, spaces and new lines, the way
// people actually paste lists of addresses. Same rule as the API.
const EMAIL_RE = /^[^\s@,;:<>"]+@[^\s@,;:<>"]+\.[a-zA-Z]{2,}$/

export function parseEmailList(raw: string) {
  const parts = raw
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const valid: string[] = []
  const invalid: string[] = []
  for (const part of parts) {
    const email = part.toLowerCase()
    if (EMAIL_RE.test(email) && email.length <= 254) {
      if (!valid.includes(email)) valid.push(email)
    } else if (!invalid.includes(part)) {
      invalid.push(part)
    }
  }
  return { valid, invalid }
}

// The four built-in roles have plain-language descriptions in the locales;
// custom roles show their own description.
export const BUILT_IN_ROLES: Record<string, string> = {
  role_global_admin: 'admin',
  role_global_maintainer: 'maintainer',
  role_global_instructor: 'instructor',
  role_global_user: 'user',
}

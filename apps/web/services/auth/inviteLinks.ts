import { getAPIUrl } from '@services/config/config'

// Client for /api/v1/invite-links (apps/api/src/routers/invite_links.py): the
// personal link in an admin's invitation email. The token always travels in
// the request body.

export type InviteLinkOrg = { id: number; org_uuid: string; slug: string; name: string; logo_image?: string | null }
export type InviteLinkDetails = {
  role: { name: string; role_uuid: string } | null
  invited_by: string | null
  message: string | null
  usergroups: string[]
  courses: string[]
  expires_at: string | null
  // False for a link the admin copied: joining waits until the email is verified.
  proves_inbox?: boolean
}
// `invitation` is there for invitations sent from the dashboard since they
// moved to the database (older links carry no details).
// `account_exists` is left out for a link an admin copied (it would let them
// probe accounts); the page then offers signup with a sign-in option.
// `status` is "accepted" once the invitation was used (the peek then still
// answers, so a person coming back after joining is sent to the org).
export type InviteLinkStatus = 'pending' | 'accepted'
export type InviteLinkInfo = {
  email: string
  org: InviteLinkOrg
  status?: InviteLinkStatus
  account_exists?: boolean
  invitation?: InviteLinkDetails
}
export type InviteLinkResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: any }

async function post<T>(path: string, body: unknown, accessToken?: string): Promise<InviteLinkResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  try {
    const res = await fetch(`${getAPIUrl()}invite-links/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data: data as T } : { ok: false, status: res.status, detail: data?.detail }
  } catch {
    return { ok: false, status: 0, detail: null }
  }
}

export const peekInviteLink = (token: string) => post<InviteLinkInfo>('peek', { token })

export const signupWithInviteLink = (body: {
  token: string
  password: string
  first_name?: string
  last_name?: string
  custom_fields?: Record<string, unknown>
}) => post<{ email: string; org: InviteLinkOrg; verification_required?: boolean }>('signup', body)

export const acceptInviteLink = (token: string, accessToken: string) =>
  post<{ org: InviteLinkOrg; already_member: boolean; role?: string | null }>('accept', { token }, accessToken)

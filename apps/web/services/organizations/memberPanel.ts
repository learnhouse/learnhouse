// API calls behind the member side panel on the Users page.
import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, apiFetch, getResponseMetadata } from '@services/utils/ts/requests'

export type MemberEvent = {
  id: number
  event_type: string
  at: string
  target_uuid?: string | null
  metadata: Record<string, any>
}

export type MemberCourse = {
  course_uuid: string
  name: string
  thumbnail_image: string
  published: boolean
  enrolled_at: string
  last_activity_at?: string | null
  activities_completed: number
  activities_total: number
  progress: number
  completed: boolean
}

/** Why a member is at risk: `code` (inactive, never_active, assignment_overdue,
 * training_overdue, unfinished_courses) with its numbers in `params`. */
export type RiskReason = { code: string; params: Record<string, any> }

export type MemberSummary = {
  user: any
  role: any
  joined_at: string
  usergroups: any[]
  security: {
    email_verified: boolean
    signup_method?: string | null
    mfa_enabled: boolean
    mfa_enabled_at?: string | null
    can_reset_mfa: boolean
    is_self: boolean
    org_requires_mfa: boolean
  }
  stats: {
    courses_enrolled: number
    courses_completed: number
    avg_progress: number
    assignments_submitted: number
    assignments_graded: number
    assignments_to_grade: number
    ai_drafts: number
    certificates: number
    active_days_30: number
    last_active_at?: string | null
  }
  at_risk: boolean
  risk_reasons: RiskReason[]
  idle_days: number | null
  activity: { date: string; events: number; active: boolean }[]
  recent: MemberEvent[]
  courses: MemberCourse[]
  certificates: { user_certification_uuid: string; course_uuid: string; course_name: string; created_at: string }[]
}

export type MemberSubmission = {
  assignment_uuid: string
  title: string
  course_uuid: string
  course_name: string
  due_date?: string | null
  status: 'PENDING' | 'SUBMITTED' | 'GRADED' | 'LATE' | 'NOT_SUBMITTED'
  attempt_number: number
  submitted_at?: string | null
  grade: { display: string; percentage: number; passed: boolean } | null
  ai_grade: { status: string; confidence?: string | null } | null
}

const base = (orgId: number, userId: number) => `${getAPIUrl()}orgs/${orgId}/users/${userId}`

export const getMemberSummary = (orgId: number, userId: number, token: string): Promise<MemberSummary> =>
  apiFetch(`${base(orgId, userId)}/summary`, token)

export const getMemberAssignments = (
  orgId: number,
  userId: number,
  token: string
): Promise<{ items: MemberSubmission[]; total: number }> => apiFetch(`${base(orgId, userId)}/assignments`, token)

export const getMemberActivity = (
  orgId: number,
  userId: number,
  token: string,
  offset = 0,
  limit = 25
): Promise<{ items: MemberEvent[]; total: number; offset: number; limit: number }> =>
  apiFetch(`${base(orgId, userId)}/activity?offset=${offset}&limit=${limit}`, token)

export async function unenrollMember(orgId: number, userId: number, courseUuid: string, token: string) {
  const res = await fetch(
    `${base(orgId, userId)}/enrollments/${encodeURIComponent(courseUuid)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, token)
  )
  return getResponseMetadata(res)
}

/** Admin-only: clear the member's two-factor so they can enroll again. */
export async function resetMemberMfa(orgId: number, userId: number, token: string) {
  const res = await fetch(
    `${getAPIUrl()}auth/mfa/org-reset/${orgId}/${userId}`,
    RequestBodyWithAuthHeader('POST', null, null, token)
  )
  return getResponseMetadata(res)
}

export async function resendVerificationEmail(orgId: number, email: string, token: string) {
  const res = await fetch(
    `${getAPIUrl()}auth/resend-verification`,
    RequestBodyWithAuthHeader('POST', { email, org_id: orgId }, null, token)
  )
  return getResponseMetadata(res)
}

export async function sendPasswordResetEmail(orgId: number, email: string, token: string) {
  const res = await fetch(
    `${getAPIUrl()}users/reset_password/send_reset_code`,
    RequestBodyWithAuthHeader('POST', { email, org_id: orgId }, null, token)
  )
  return getResponseMetadata(res)
}

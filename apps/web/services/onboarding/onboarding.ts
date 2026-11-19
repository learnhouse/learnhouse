import { getAPIUrl } from '@services/config/config'
import { errorHandling } from '@services/utils/ts/requests'

// Client for /api/v1/onboarding (apps/api/src/routers/onboarding.py).

export type OnboardingGoal = 'sell' | 'team' | 'school' | 'customers' | 'community'
export const ONBOARDING_GOALS: OnboardingGoal[] = ['sell', 'team', 'school', 'customers', 'community']

export type ServerStep = {
  id: string
  kind: 'data' | 'click'
  minutes: number
  done: boolean
  skipped: boolean
}

export type OnboardingState = {
  org_id: number
  goal: OnboardingGoal | null
  goals: OnboardingGoal[]
  mode: 'saas' | 'ee' | 'oss'
  plan: string | null
  steps: ServerStep[]
  done_count: number
  total: number
  all_done: boolean
  next_step: string | null
  celebrate: string[]
  dismissed: boolean
  welcome_seen: boolean
  starter_applied: boolean
  recommended_plan: string | null
  invites: { gated: boolean; unlocks_at: string | null }
  milestones: Record<string, string>
}

export type SlugCheck = {
  slug: string
  available: boolean
  reason: 'taken' | 'reserved' | 'invalid' | null
  suggestion: string
}

export type PickerPlan = {
  id: string
  limits: { courses: number; members: number; admin_seats: number; ai_credits: number }
  unlocks: string[]
  contact_sales: boolean
  current: boolean
  /** The plan a running free trial unlocks (the org hasn't bought it yet). */
  trial?: boolean
  recommended: boolean
}

export type PlanPickerData = {
  current_plan: string | null
  trial_plan?: string | null
  recommended_plan: string
  goal: OnboardingGoal | null
  can_continue_free: boolean
  upgrades: string[]
  plans: PickerPlan[]
}

export type HubOrg = {
  org_id: number
  role: 'admin' | 'maintainer' | 'instructor' | 'member' | 'custom'
  plan: string | null
  status: string | null
  poc_ends_at: string | null
  setup: { done: number; total: number; goal: OnboardingGoal | null } | null
}

export type PendingInvite = {
  org_uuid: string
  org_id: number
  name: string
  slug: string
  logo_image: string | null
  invited_at: string | null
  // Database invitations also say who sent them, the role and any note.
  role?: string | null
  role_uuid?: string | null
  invited_by?: string | null
  message?: string | null
  expires_at?: string | null
  courses?: number
  usergroups?: number
  // Already in the org: the invitation changes the role (or adds courses),
  // so the button accepts rather than joins.
  already_member?: boolean
}

// `invites` is empty until the user's email is verified (`email_verified`):
// invitations belong to the verified owner of the address.
export type HubSummary = { mode: string; orgs: HubOrg[]; invites: PendingInvite[]; email_verified: boolean }

export type OnboardingEvent =
  | 'welcome_completed'
  | 'starter_skipped'
  | 'plan_picker_viewed'
  | 'continued_free'
  | 'checkout_started'
  | 'invite_link_copied'
  | 'learners_imported'
  | 'first_publish_celebrated'
  | 'checklist_dismissed'
  | 'share_grow'
  | 'setup_payments'

const base = () => `${getAPIUrl()}onboarding`

async function request<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  return errorHandling(res)
}

export const checkSlug = (token: string | undefined, name: string, slug?: string) => {
  const q = new URLSearchParams({ name })
  if (slug) q.set('slug', slug)
  return request<SlugCheck>(`/slug?${q.toString()}`, token)
}

// ``idempotencyKey``: one per attempt (see createAttempt.ts). A retry with the
// same key, or the same name moments later, returns the org already made
// (``reused: true``) instead of creating another.
export const createOrgWithOnboarding = (
  token: string | undefined,
  body: { name: string; slug?: string; goal?: OnboardingGoal | null },
  idempotencyKey?: string,
) =>
  request<{ org: any; onboarding: OnboardingState; reused?: boolean }>('/orgs', token, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  })

export const applyStarter = (token: string | undefined, orgId: number, body: { website?: boolean; course?: boolean } = {}) =>
  request<{ template: string | null; page_uuid: string | null; course_uuid: string | null }>(`/orgs/${orgId}/starter`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const getOnboardingState = (token: string | undefined, orgId: number) =>
  request<OnboardingState>(`/orgs/${orgId}`, token)

export type OnboardingPatch = {
  goal?: OnboardingGoal
  clear_goal?: boolean
  dismissed?: boolean
  welcome_seen?: boolean
  skip?: string
  unskip?: string
  celebrated?: string[]
}

export const patchOnboardingState = (token: string | undefined, orgId: number, body: OnboardingPatch) =>
  request<OnboardingState>(`/orgs/${orgId}`, token, { method: 'PATCH', body: JSON.stringify(body) })

export const recordOnboardingEvent = (token: string | undefined, orgId: number, event: OnboardingEvent) =>
  request<{ event: string; first: boolean }>(`/orgs/${orgId}/events`, token, {
    method: 'POST',
    body: JSON.stringify({ event }),
  })

export const getPlanPicker = (token: string | undefined, orgId: number) =>
  request<PlanPickerData>(`/orgs/${orgId}/plans`, token)

export const getHubSummary = (token: string | undefined) => request<HubSummary>('/hub', token)

export const acceptInvite = (token: string | undefined, orgUuid: string) =>
  request<{ org_id: number; slug: string; name: string }>(`/invites/${encodeURIComponent(orgUuid)}/accept`, token, {
    method: 'POST',
  })

export const declineInvite = (token: string | undefined, orgUuid: string) =>
  request<{ org_id: number; declined: boolean }>(`/invites/${encodeURIComponent(orgUuid)}/decline`, token, {
    method: 'POST',
  })

export const onboardingKeys = {
  state: (orgId: number | string | undefined) => ['onboarding', 'state', String(orgId ?? '')] as const,
  plans: (orgId: number | string | undefined) => ['onboarding', 'plans', String(orgId ?? '')] as const,
  hub: () => ['onboarding', 'hub'] as const,
}

/** One click: a private, editable course shaped by the org's goal (no AI). */
export const createFirstCourse = (token: string | undefined, orgId: number) =>
  request<{ course_uuid: string }>(`/orgs/${orgId}/first-course`, token, { method: 'POST' })

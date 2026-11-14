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
  recommended: boolean
}

export type PlanPickerData = {
  current_plan: string | null
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

export const createOrgWithOnboarding = (
  token: string | undefined,
  body: { name: string; slug?: string; goal?: OnboardingGoal | null },
) => request<{ org: any; onboarding: OnboardingState }>('/orgs', token, { method: 'POST', body: JSON.stringify(body) })

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

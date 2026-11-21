import { getAPIUrl } from '@services/config/config'

// Course contributions: /contributions. Suggested edits and feedback from the
// learner page, the review queue, and credit. Off unless the course owner
// turns it on (Contributions tab).

export type JSONNode = Record<string, any>

export type ContributorUser = {
  id: number
  user_uuid: string
  username: string
  first_name: string
  last_name: string
  avatar_image: string
}

export type ContributionAudience = 'enrolled' | 'members' | 'signed_in'

export type ContributionSettings = {
  enabled: boolean
  audience: ContributionAudience
  allow_suggestions: boolean
  allow_feedback: boolean
  trusted_publish: boolean
  plan_allowed: boolean
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'changes_requested' | 'withdrawn'
export type PlacementState = 'clean' | 'moved' | 'conflict' | 'outdated'

export type SuggestionPlacement = {
  state: PlacementState
  current_version: number
  start_index: number | null
  current: JSONNode[]
}

export type Suggestion = {
  suggestion_uuid: string
  status: SuggestionStatus
  author: ContributorUser | null
  reviewer: ContributorUser | null
  course_uuid: string
  course_name: string
  activity_uuid: string
  activity_name: string
  base_version: number
  start_index: number
  before: JSONNode[]
  after: JSONNode[]
  note: string
  summary: string
  review_note: string
  reviewed_at: string | null
  applied_version: number | null
  auto_published: boolean
  created_at: string
  updated_at: string
  placement: SuggestionPlacement | null
}

export type FeedbackType = 'typo' | 'unclear' | 'outdated' | 'wrong' | 'suggestion'
export const FEEDBACK_TYPES: FeedbackType[] = ['typo', 'unclear', 'outdated', 'wrong', 'suggestion']

export type FeedbackComment = {
  comment_uuid: string
  author: ContributorUser | null
  body: string
  created_at: string
  from_team: boolean
}

export type Feedback = {
  thread_uuid: string
  feedback_type: FeedbackType
  status: 'open' | 'resolved'
  quote: string
  anchor: { block_index: number | null; block_fp: string } | null
  author: ContributorUser | null
  course_uuid: string
  activity_uuid: string
  activity_name: string
  created_at: string
  updated_at: string
  comments: FeedbackComment[]
}

export type BlockCredit = { block_index: number; block_fp: string; users: ContributorUser[] }

export type ContributionContext = {
  enabled: boolean
  can_suggest: boolean
  can_feedback: boolean
  can_review: boolean
  publishes_directly: boolean
  current_version: number
  reason: 'signin' | 'enroll' | 'members' | 'blocked' | 'access' | null
  credits: BlockCredit[]
  my_open_suggestions: number
}

export type Contributor = {
  user: ContributorUser
  accepted_count: number
  trusted: boolean
  blocked: boolean
  first_contribution_at: string | null
  last_contribution_at: string | null
}

export type ContributionSummary = { pending_suggestions: number; open_feedback: number; contributors: number }

export type UserContributionCourse = {
  course_uuid: string
  course_name: string
  thumbnail_image: string
  accepted_count: number
  last_contribution_at: string | null
}

export class ContributionsApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const base = () => `${getAPIUrl()}contributions`
const enc = encodeURIComponent

async function call<T>(url: string, method: string, token: string | undefined, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    let code: string | undefined
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') detail = data.detail
      else if (data?.detail && typeof data.detail === 'object') {
        code = data.detail.code
        detail = data.detail.message ?? detail
      }
    } catch {
      // Not JSON: keep the status text.
    }
    throw new ContributionsApiError(res.status, detail, code)
  }
  return (await res.json()) as T
}

// ── course (reviewers, owners) ──

export const getContributionSettings = (courseUuid: string, token: string) =>
  call<ContributionSettings>(`${base()}/courses/${enc(courseUuid)}/settings`, 'GET', token)

export const updateContributionSettings = (courseUuid: string, data: Partial<ContributionSettings>, token: string) =>
  call<ContributionSettings>(`${base()}/courses/${enc(courseUuid)}/settings`, 'PUT', token, data)

export const getContributionSummary = (courseUuid: string, token: string) =>
  call<ContributionSummary>(`${base()}/courses/${enc(courseUuid)}/summary`, 'GET', token)

export const listCourseSuggestions = (courseUuid: string, status: string | null, token: string, page = 1) =>
  call<{ items: Suggestion[]; total: number }>(
    `${base()}/courses/${enc(courseUuid)}/suggestions?page=${page}&limit=50${status ? `&status=${enc(status)}` : ''}`,
    'GET',
    token
  )

export const listCourseFeedback = (courseUuid: string, status: string | null, token: string, page = 1) =>
  call<{ items: Feedback[]; total: number }>(
    `${base()}/courses/${enc(courseUuid)}/feedback?page=${page}&limit=50${status ? `&status=${enc(status)}` : ''}`,
    'GET',
    token
  )

export const listCourseContributors = (courseUuid: string, token: string | undefined, manage = false) =>
  call<{ items: Contributor[]; total: number }>(
    `${base()}/courses/${enc(courseUuid)}/contributors${manage ? '?manage=true' : ''}`,
    'GET',
    token
  )

export const updateContributor = (
  courseUuid: string,
  userId: number,
  data: { trusted?: boolean; blocked?: boolean },
  token: string
) => call<Contributor>(`${base()}/courses/${enc(courseUuid)}/contributors/${userId}`, 'PUT', token, data)

// ── the learner page ──

export const getContributionContext = (activityUuid: string, token: string | undefined) =>
  call<ContributionContext>(`${base()}/activities/${enc(activityUuid)}/context`, 'GET', token)

export type SuggestionDraft = {
  base_version: number
  start_index: number
  before: JSONNode[]
  after: JSONNode[]
  prev_fp?: string | null
  note?: string
}

export const createSuggestion = (activityUuid: string, data: SuggestionDraft, token: string) =>
  call<Suggestion>(`${base()}/activities/${enc(activityUuid)}/suggestions`, 'POST', token, data)

export const createFeedback = (
  activityUuid: string,
  data: { feedback_type: FeedbackType; body: string; quote?: string; block_index?: number | null; block_fp?: string | null },
  token: string
) => call<Feedback>(`${base()}/activities/${enc(activityUuid)}/feedback`, 'POST', token, data)

export const listMyFeedback = (activityUuid: string, token: string) =>
  call<{ items: Feedback[]; total: number }>(`${base()}/activities/${enc(activityUuid)}/feedback/mine`, 'GET', token)

export const listMySuggestions = (activityUuid: string | null, token: string) =>
  call<{ items: Suggestion[]; total: number }>(
    `${base()}/suggestions/mine${activityUuid ? `?activity_uuid=${enc(activityUuid)}` : ''}`,
    'GET',
    token
  )

// ── one suggestion ──

export const getSuggestion = (uuid: string, token: string) => call<Suggestion>(`${base()}/suggestions/${enc(uuid)}`, 'GET', token)

export const reviseSuggestion = (uuid: string, data: { after: JSONNode[]; note?: string }, token: string) =>
  call<Suggestion>(`${base()}/suggestions/${enc(uuid)}`, 'PUT', token, data)

export const acceptSuggestion = (
  uuid: string,
  data: {
    after?: JSONNode[]
    note?: string
    target?: { start_index: number; length: number; version: number }
    /** The updated_at you reviewed: refused (409, code "revised") if the author changed it since. */
    expected_updated_at?: string
  },
  token: string
) => call<Suggestion>(`${base()}/suggestions/${enc(uuid)}/accept`, 'POST', token, data)

export const rejectSuggestion = (uuid: string, note: string, token: string) =>
  call<Suggestion>(`${base()}/suggestions/${enc(uuid)}/reject`, 'POST', token, { note })

export const requestSuggestionChanges = (uuid: string, note: string, token: string) =>
  call<Suggestion>(`${base()}/suggestions/${enc(uuid)}/request-changes`, 'POST', token, { note })

export const withdrawSuggestion = (uuid: string, token: string) =>
  call<Suggestion>(`${base()}/suggestions/${enc(uuid)}/withdraw`, 'POST', token)

// ── feedback threads ──

export const replyToFeedback = (threadUuid: string, body: string, token: string) =>
  call<Feedback>(`${base()}/feedback/${enc(threadUuid)}/replies`, 'POST', token, { body })

export const setFeedbackStatus = (threadUuid: string, status: 'open' | 'resolved', token: string) =>
  call<Feedback>(`${base()}/feedback/${enc(threadUuid)}/status`, 'PUT', token, { status })

// ── profiles ──

export const getUserContributions = (userUuid: string, orgId: number, token: string | undefined) =>
  call<{ items: UserContributionCourse[]; total_accepted: number }>(
    `${base()}/users/${enc(userUuid)}/contributions?org_id=${orgId}`,
    'GET',
    token
  )

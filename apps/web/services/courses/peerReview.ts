import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

// Peer review on assignments. Router: apps/api/src/routers/courses/peer_review.py,
// mounted under /assignments. Every helper throws on a non-2xx response (an
// Error carrying `status` and `detail`, see errorHandling) so react-query and
// toasts get one failure path. Types are shared with the instructor dashboard.

// ─── Shared types ────────────────────────────────────────────────────────────

export type PeerReviewAnonymity = 'double_blind' | 'anonymous_reviewer' | 'named'
export type PeerReviewScoreMode = 'feedback_only' | 'suggest_grade'
export type PeerReviewKind = 'peer' | 'self' | 'calibration'
export type PeerReviewStatus = 'assigned' | 'submitted' | 'discarded'
export type PeerReviewUnlockReason = 'reviews' | 'due_date' | null

export interface PeerReviewLevel {
  id: string
  points: number
  label: string
  description?: string | null
}

export interface PeerReviewCriterion {
  id: string
  title: string
  description?: string | null
  levels: PeerReviewLevel[]
}

export type PeerReviewRubric = PeerReviewCriterion[]

export interface PeerReviewPrompt {
  key: string
  label: string
  min_chars: number
}

/** `{criterion_id: level_id}` */
export type PeerReviewScores = Record<string, string>
/** `{prompt_key: text}` or `{criterion_id: text}` */
export type PeerReviewComments = Record<string, string>

export interface PeerReviewCalibrationSample {
  id: string
  title: string
  /** Markdown text. */
  content: string
  /** Instructor levels. Stripped for learners. */
  scores?: PeerReviewScores
  /** Stripped for learners until they have scored the sample. */
  explanation?: string | null
  /** Learner-side only: has this learner scored the sample yet. */
  done?: boolean
  /** Learner-side only: the learner's own levels once done. */
  my_scores?: PeerReviewScores | null
}

export interface PeerReviewSettings {
  /** Null when no row is saved yet (defaults come back with enabled: false). */
  id?: number | null
  assignment_id?: number
  assignment_uuid?: string
  org_id?: number
  enabled: boolean
  reviews_required: number
  require_reviews_to_see_feedback: boolean
  review_due_date: string | null
  anonymity: PeerReviewAnonymity
  self_review_enabled: boolean
  calibration_enabled: boolean
  helpfulness_enabled: boolean
  revision_plan_enabled: boolean
  /** Null means "use the translated defaults". */
  prompts: PeerReviewPrompt[] | null
  /** What the server validates against (the defaults when `prompts` is null). Never null. */
  effective_prompts?: PeerReviewPrompt[]
  rubric: PeerReviewRubric
  score_mode: PeerReviewScoreMode
  min_reviews_for_score: number
  /** Learners get `{id, title, content}` only. */
  calibration_samples: PeerReviewCalibrationSample[]
  creation_date?: string | null
  update_date?: string | null
  /** The org's plan includes peer review. */
  feature_available?: boolean
}

export type PeerReviewSettingsUpdate = Partial<
  Omit<
    PeerReviewSettings,
    'id' | 'assignment_id' | 'assignment_uuid' | 'org_id' | 'creation_date' | 'update_date' | 'effective_prompts' | 'feature_available'
  >
>

/** The other party, as far as anonymity allows. */
export interface PeerReviewParty {
  /** "Reviewer 2", "Classmate"… when anonymous. */
  label?: string | null
  user_id?: number | null
  username?: string | null
  first_name?: string | null
  last_name?: string | null
  avatar_image?: string | null
  user_uuid?: string | null
}

export interface PeerReview {
  review_uuid: string
  kind: PeerReviewKind
  status: PeerReviewStatus
  attempt_number?: number
  calibration_sample_id?: string | null
  scores: PeerReviewScores
  comments: PeerReviewComments
  criterion_comments?: PeerReviewComments | null
  helpfulness?: number | null
  helpfulness_note?: string | null
  flagged?: boolean
  flag_reason?: string | null
  discarded_by?: number | null
  discard_reason?: string | null
  assigned_at?: string | null
  submitted_at?: string | null
  creation_date?: string
  update_date?: string
  /** "Reviewer 1..n" on received reviews when the reviewer is hidden. */
  reviewer_label?: string | null
  reviewer?: PeerReviewParty | null
  reviewee?: PeerReviewParty | null
  /** Percentage of this review (sum points / sum max points × 100), when the API computes it. */
  percentage?: number | null
}

export interface PeerScoreCriterion {
  criterion_id: string
  /** Median level points across the counted peer reviews. */
  median: number
  max_points?: number
}

/**
 * Built from submitted, non-discarded peer reviews of the current attempt,
 * only once there are at least `min_reviews_for_score` of them.
 */
export interface PeerScore {
  /** The API sends an array; the map form is accepted for older payloads. */
  criteria: PeerScoreCriterion[] | Record<string, number>
  /** sum(medians) / sum(max points) × 100. */
  percentage: number | null
  /** How many reviews the score is based on. */
  review_count: number
  /** max − min review percentage; null with fewer than 2 reviews. */
  spread: number | null
}

export interface PeerReviewReflection {
  plan: string
  creation_date?: string
  update_date?: string
}

export interface PeerReviewSteps {
  self: { enabled: boolean; done: boolean }
  calibration: { enabled: boolean; total: number; done: number }
  /** `required` is the effective target: min(setting, classmates with a reviewable submission); `configured` is the setting. */
  reviews: { required: number; configured?: number; done: number; open_review_uuid: string | null; available: boolean }
  feedback: { unlocked: boolean; reason: PeerReviewUnlockReason; count: number }
}

/** The settings subset a learner sees on GET /me. */
export interface PeerReviewLearnerSettings {
  rubric: PeerReviewRubric
  prompts: PeerReviewPrompt[] | null
  effective_prompts?: PeerReviewPrompt[]
  reviews_required: number
  require_reviews_to_see_feedback: boolean
  review_due_date: string | null
  anonymity: PeerReviewAnonymity
  self_review_enabled: boolean
  calibration_enabled: boolean
  helpfulness_enabled: boolean
  revision_plan_enabled: boolean
  score_mode?: PeerReviewScoreMode
  min_reviews_for_score?: number
}

export interface PeerReviewLearnerState {
  enabled: boolean
  /** The viewer teaches this course; learner actions answer 403 for them. */
  is_instructor?: boolean
  settings: PeerReviewLearnerSettings
  my_submission_status: string | null
  attempt_number?: number
  steps: PeerReviewSteps
  /** Empty until feedback is unlocked. */
  received: PeerReview[]
  self_review: PeerReview | null
  peer_score: PeerScore | null
  reflection: PeerReviewReflection | null
  given_stats: { done: number; avg_helpfulness: number | null }
}

export interface PeerReviewTask {
  assignment_task_uuid: string
  title: string
  description?: string | null
  assignment_type: string
  /** Task contents with answer keys / solutions stripped. */
  contents: any
  /** The reviewee's saved answer for this task (shape depends on the type). */
  task_submission: any
  /** For FILE_SUBMISSION: the review file endpoint for this task. */
  file_url?: string | null
  order?: number | null
  /** The task is graded automatically (quiz, number, keyed short answer, form
   *  blanks, tested code), so the classmate's answer is withheld. */
  answer_hidden?: boolean
}

/** GET /peer-review/reviews/{review_uuid} */
export interface PeerReviewDetail {
  review: PeerReview
  tasks: PeerReviewTask[]
  reviewee?: PeerReviewParty | null
  assignment_uuid?: string
  assignment_title?: string
  rubric?: PeerReviewRubric
  prompts?: PeerReviewPrompt[] | null
  effective_prompts?: PeerReviewPrompt[]
  /** The reviewee started a new attempt: `task_submission` is null and the review is closed. */
  submission_changed?: boolean
}

export interface PeerReviewNextResult {
  review: PeerReview | null
  reason?: 'none_available' | null
}

export interface CalibrationComparisonRow {
  criterion_id: string
  title?: string
  match?: boolean
  your_level_id: string | null
  instructor_level_id: string | null
  your_points?: number | null
  instructor_points?: number | null
}

export interface CalibrationResult {
  sample_id: string
  criteria: CalibrationComparisonRow[]
  explanation: string | null
}

export interface PeerReviewSavePayload {
  scores: PeerReviewScores
  comments: PeerReviewComments
  criterion_comments?: PeerReviewComments
  submit: boolean
}

// ── instructor views ──

export interface PeerReviewOverviewTotals {
  submitted_learners: number
  reviews_submitted: number
  reviews_assigned: number
  flagged: number
  below_target: number
}

export interface PeerReviewSubmissionRow {
  user: PeerReviewParty
  user_id: number
  submission_status: string
  attempt_number?: number
  reviews_received: number
  reviews_target?: number
  peer_score: PeerScore | null
  spread: number | null
  self_score: number | null
  flagged_count: number
}

export interface PeerReviewReviewerRow {
  user: PeerReviewParty
  user_id: number
  reviews_done: number
  reviews_required: number
  avg_helpfulness: number | null
  bias: number | null
  calibration_deviation: number | null
}

export interface PeerReviewOverview {
  totals: PeerReviewOverviewTotals
  submissions: PeerReviewSubmissionRow[]
  reviewers: PeerReviewReviewerRow[]
  flagged?: PeerReview[]
}

export interface PeerReviewSubmissionDetail {
  user: PeerReviewParty
  user_id?: number
  submission_status?: string
  attempt_number?: number
  reviews: PeerReview[]
  self_review: PeerReview | null
  peer_score: PeerScore | null
  reflection: PeerReviewReflection | null
}

/** 409 detail when the reviewer started a retry and hasn't handed it in yet. */
export const PEER_REVIEW_RETRYING_DETAIL = 'Hand in your new attempt before reviewing again'

export function isPeerReviewRetrying(e: any): boolean {
  return e?.status === 409 && e?.detail === PEER_REVIEW_RETRYING_DETAIL
}

// ─── Request helpers ─────────────────────────────────────────────────────────

const base = () => `${getAPIUrl()}assignments`

async function request<T>(url: string, method: string, body: any, accessToken: string): Promise<T> {
  const res = await fetch(url, RequestBodyWithAuthHeader(method, body ?? null, null, accessToken))
  return errorHandling(res) as Promise<T>
}

// ─── Learner ─────────────────────────────────────────────────────────────────

/** Settings (rubric, prompts). Calibration answers are stripped for learners. */
export function getPeerReviewSettings(assignmentUUID: string, accessToken: string) {
  return request<PeerReviewSettings>(`${base()}/${assignmentUUID}/peer-review/settings`, 'GET', null, accessToken)
}

export function getPeerReviewMe(assignmentUUID: string, accessToken: string) {
  return request<PeerReviewLearnerState>(`${base()}/${assignmentUUID}/peer-review/me`, 'GET', null, accessToken)
}

/** Open review if one exists, otherwise a fresh pick, or `{review: null}`. */
export function requestNextPeerReview(assignmentUUID: string, accessToken: string) {
  return request<PeerReviewNextResult>(`${base()}/${assignmentUUID}/peer-review/me/next`, 'POST', {}, accessToken)
}

export function getPeerReview(reviewUUID: string, accessToken: string) {
  return request<PeerReviewDetail>(`${base()}/peer-review/reviews/${reviewUUID}`, 'GET', null, accessToken)
}

/** Save a draft, or submit when `payload.submit`. */
export function savePeerReview(reviewUUID: string, payload: PeerReviewSavePayload, accessToken: string) {
  return request<PeerReview>(`${base()}/peer-review/reviews/${reviewUUID}`, 'PUT', payload, accessToken)
}

export function peerReviewFileUrl(reviewUUID: string, taskUUID: string) {
  return `${base()}/peer-review/reviews/${reviewUUID}/files/${taskUUID}`
}

/**
 * The file endpoint needs the bearer token, so a plain link would 401. Fetch
 * it as a blob and hand the browser an object URL instead.
 */
export async function downloadPeerReviewFile(
  reviewUUID: string,
  taskUUID: string,
  accessToken: string,
  url?: string | null
): Promise<void> {
  const target = url && url.startsWith(getAPIUrl()) ? url : peerReviewFileUrl(reviewUUID, taskUUID)
  const res = await fetch(target, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) {
    await errorHandling(res)
    return
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  const filename = match ? decodeURIComponent(match[1]) : `submission-${taskUUID.slice(-6)}`
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
}

export function submitSelfReview(
  assignmentUUID: string,
  payload: { scores: PeerReviewScores; comments: PeerReviewComments; criterion_comments?: PeerReviewComments },
  accessToken: string
) {
  return request<PeerReview>(`${base()}/${assignmentUUID}/peer-review/me/self`, 'POST', payload, accessToken)
}

export async function getCalibrationSamples(assignmentUUID: string, accessToken: string) {
  const data = await request<any>(`${base()}/${assignmentUUID}/peer-review/me/calibration`, 'GET', null, accessToken)
  const samples: PeerReviewCalibrationSample[] = Array.isArray(data) ? data : Array.isArray(data?.samples) ? data.samples : []
  return samples
}

export function submitCalibration(
  assignmentUUID: string,
  sampleId: string,
  scores: PeerReviewScores,
  accessToken: string
) {
  return request<CalibrationResult>(
    `${base()}/${assignmentUUID}/peer-review/me/calibration/${encodeURIComponent(sampleId)}`,
    'POST',
    { scores },
    accessToken
  )
}

export function ratePeerReview(reviewUUID: string, body: { helpfulness: number; note?: string | null }, accessToken: string) {
  return request<PeerReview>(`${base()}/peer-review/reviews/${reviewUUID}/rate`, 'POST', body, accessToken)
}

export function flagPeerReview(reviewUUID: string, reason: string, accessToken: string) {
  return request<PeerReview>(`${base()}/peer-review/reviews/${reviewUUID}/flag`, 'POST', { reason }, accessToken)
}

export function savePeerReflection(assignmentUUID: string, plan: string, accessToken: string) {
  return request<PeerReviewReflection>(`${base()}/${assignmentUUID}/peer-review/me/reflection`, 'PUT', { plan }, accessToken)
}

// Instructor calls live in ./peerReviewAdmin.ts.

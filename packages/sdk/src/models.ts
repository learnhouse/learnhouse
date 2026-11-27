// Friendly names for the generated schema components the resources return.
// Everything here is an alias of src/generated/schema.ts, except the auth
// response shapes noted below.
import type { components } from './generated/schema'

type Schemas = components['schemas']

export type Organization = Schemas['OrganizationRead']
export type Course = Schemas['CourseRead']
/** A course with its chapters and their activities (`GET /courses/{uuid}/meta`). */
export type CourseMeta = Schemas['FullCourseRead']
export type Chapter = Schemas['ChapterRead']
export type Activity = Schemas['ActivityRead']
export type Trail = Schemas['TrailRead']
export type TrailRun = Schemas['TrailRunRead']
export type TrailStep = Schemas['TrailStep']
export type SearchResult = Schemas['SearchResult']
export type User = Schemas['UserRead']
/** What other users may see of a user. */
export type PublicUserProfile = Schemas['UserReadPublic']
export type UserSession = Schemas['UserSession']
export type AuthMe = Schemas['AuthMeResponse']

// The API declares no response_model for /auth/login, /auth/login/mfa and
// /auth/refresh, so the generated types say `unknown`. These mirror the dicts
// apps/api/src/routers/auth.py returns.

export interface AuthTokens {
  access_token: string
  refresh_token: string
  /** Access-token expiry as a Unix timestamp in milliseconds. */
  expiry: number | null
}

export interface LoginSuccess {
  mfa_required?: false
  user: User
  tokens: AuthTokens
}

export interface LoginMfaChallenge {
  mfa_required: true
  /** Pass to `auth.loginMfa()` together with the user's code. */
  mfa_token: string
}

export type LoginResult = LoginSuccess | LoginMfaChallenge

/**
 * A short-lived learner session for the embed components, minted on your
 * server with `client.embed.createSession()`. Hand `access_token` to the
 * browser; the org API token stays on the server.
 */
export interface EmbedSession {
  access_token: string
  token_type: 'bearer'
  /** Seconds until it expires. */
  expires_in: number
  /** Unix time (seconds) it expires at. */
  expires_at: number
  user_id: number
  user_uuid: string
  /** The organization the session works in (and only in). */
  org_id: number
}

// ---------------------------------------------------------------------------
// Accounts

export type UserSignup = Schemas['UserSignupRead']
export type UserUpdateInput = Schemas['UserUpdate']
export type UserPreferences = Schemas['UserPreferences']
export type UserPreferencesInput = Schemas['UserPreferencesUpdate']

/** `auth.verifyMagicLink()`: a sign-in, plus where the link wanted to land. */
export type MagicLinkResult = LoginResult & {
  /** Relative path the link was asked from, when there was one. */
  next?: string
  redirect_to?: string
}

/** `auth.verifyEmail()`. Signs the user in when the account allows it. */
export interface VerifyEmailResult {
  message: string
  next?: string
  redirect_to?: string
  /** Present when the verification also signed the user in. */
  user?: User
  tokens?: AuthTokens
  mfa_required?: boolean
  mfa_token?: string
}

/** Two-factor state of the signed-in account (`auth.mfa.status()`). */
export interface MfaStatus {
  enabled: boolean
  confirmed_at: string | null
  backup_codes_remaining: number
  /** False for accounts that only sign in with Google, SSO or magic links. */
  has_password: boolean
}

/** `auth.mfa.setup()`: show `provisioning_uri` as a QR code, then `confirm()`. */
export interface MfaSetup {
  secret: string
  provisioning_uri: string
}

/**
 * `auth.mfa.confirm()`. Turning two-factor on signs out every other session
 * and returns fresh tokens for this one.
 */
export interface MfaEnabled {
  enabled: true
  /** Show once; each works one time in place of a code. */
  backup_codes: string[]
  tokens: AuthTokens
}

export interface MfaDisabled {
  enabled: false
  tokens: AuthTokens
}

// ---------------------------------------------------------------------------
// Courses

export type CourseUpdate = Schemas['CourseUpdateRead']
export type CustomDomainResolution = Schemas['CustomDomainResolveResponse']

/** Progress through one course, computed from a trail by `courseProgress()`. */
export interface CourseProgress {
  /** Whether the trail has a run for the course (the learner started it). */
  enrolled: boolean
  /** Activities with a completion step. */
  completed: number
  /** Activities in the course when the run was read, or 0 when unknown. */
  total: number
  /** 0 to 100, rounded down. 0 when `total` is unknown. */
  percent: number
  /** Numeric ids of the completed activities. */
  completedActivityIds: number[]
  /** The run itself, when enrolled. */
  run: TrailRun | null
}

// ---------------------------------------------------------------------------
// Assignments

export type Assignment = Schemas['AssignmentRead']
export type MyAssignment = Schemas['MyAssignmentItem']
export type AssignmentTaskType = Schemas['AssignmentTaskTypeEnum']
export type AssignmentSubmissionStatus = 'PENDING' | 'SUBMITTED' | 'GRADED' | 'LATE' | 'NOT_SUBMITTED'

// The assignments router declares no response_model for tasks and
// submissions; these mirror the SQLModel read models in
// apps/api/src/db/courses/assignments.py.

export interface AssignmentTask {
  id: number
  assignment_task_uuid: string
  title: string
  description: string
  hint: string
  reference_file: string | null
  assignment_type: AssignmentTaskType
  /** The task definition (quiz questions, form fields, custom data). */
  contents: Record<string, unknown>
  max_grade_value: number
  order: number | null
  creation_date: string
  update_date: string
}

export interface AssignmentTaskSubmission {
  id: number
  assignment_task_submission_uuid: string
  /** The learner's answer. For file tasks: `{ fileUUID }` from `uploadTaskFile()`. */
  task_submission: Record<string, unknown>
  grade: number
  task_submission_grade_feedback: string
  manually_graded: boolean
  assignment_type: AssignmentTaskType
  user_id: number
  activity_id: number
  course_id: number
  chapter_id: number
  assignment_task_id: number
  creation_date: string
  update_date: string
}

export interface AssignmentSubmission {
  id: number
  submission_status: AssignmentSubmissionStatus
  grade: number
  overall_feedback: string | null
  attempt_number: number
  user_id: number
  assignment_id: number
  creation_date: string
  update_date: string
}

export interface AssignmentTaskGrade {
  index: number
  assignment_task_uuid: string
  title: string
  description: string
  assignment_type: AssignmentTaskType
  submitted: boolean
  grade: number
  max_grade: number
  percentage: number
  percentage_display: string
  points_summary: string
  passed: boolean
  feedback: string | null
  manually_graded: boolean
}

/** `assignments.getGrade()`: the grade in every format the UI shows. */
export interface AssignmentGrade {
  grade: number
  max_grade: number
  percentage: number
  /** Formatted for the assignment's grading type: `"B"`, `"85.00%"`, `"Pass"`, `"3.0"`, `"85/100"`. */
  display_grade: string
  letter_grade: string
  points_summary: string
  percentage_display: string
  passed: boolean
  passing_threshold: number
  grading_type: string
  overall_feedback: string | null
  tasks: AssignmentTaskGrade[]
  ai_graded: boolean
  ai_scored_task_uuids: string[]
}

export interface AssignmentRetry {
  message: string
  attempt_number: number
  max_retries: number
  submission: AssignmentSubmission
}

export interface AssignmentTaskSubmissionInput {
  /** The answer, stored as-is. For file tasks: `{ fileUUID }`. */
  taskSubmission: Record<string, unknown>
  /** Update this submission instead of creating one. */
  submissionUuid?: string | null
}

// ---------------------------------------------------------------------------
// Certificates

export type Certification = Schemas['CertificationRead']

export interface CertificateUser {
  id: number
  user_id: number
  certification_id: number
  user_certification_uuid: string
  created_at: string
  updated_at: string
}

export interface CertificateCourseCard {
  id: number
  course_uuid: string
  name: string
  description: string | null
  thumbnail_image: string | null
  org_id: number
  default_locale?: string
  [key: string]: unknown
}

/** One earned certificate (`certificates.listMine()`, `certificates.get()`). */
export interface Certificate {
  certificate_user: CertificateUser
  certification: Certification | null
  course?: CertificateCourseCard
  user: {
    id?: number | null
    user_uuid: string | null
    username: string | null
    email?: string | null
    first_name: string | null
    last_name: string | null
  }
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Paths, communities, podcasts, notes, calendar

export type LearningPath = Schemas['PathRead']
export type Community = Schemas['CommunityRead']
export type CommunityActivity = Schemas['CommunityActivity']
export type CommunitySummary = Schemas['CommunitySummary']
export type Discussion = Schemas['DiscussionReadWithCounts']
export type DiscussionWithVote = Schemas['DiscussionReadWithVoteStatus']
export type DiscussionComment = Schemas['DiscussionCommentReadWithVoteStatus']
export type DiscussionLabel = Schemas['DiscussionLabelInfo']
export type DiscussionReaction = Schemas['DiscussionReactionSummary']
export type DiscussionVote = Schemas['DiscussionVoteRead']
export type DiscussionCommentVote = Schemas['DiscussionCommentVoteRead']
export type DiscussionSort = Schemas['DiscussionSortBy']
export type Podcast = Schemas['PodcastRead']
export type PodcastWithEpisodeCount = Schemas['PodcastReadWithEpisodeCount']
export type PodcastEpisode = Schemas['PodcastEpisodeRead']
export type Note = Schemas['NoteRead']
export type NoteList = Schemas['NoteList']
export type NoteAnchor = Schemas['NoteAnchor']
export type CalendarEvent = Schemas['CalendarEvent']

// ---------------------------------------------------------------------------
// Notifications (the router declares no response_model; these mirror
// apps/api/src/services/notifications/notifications.py)

export type NotificationCategory = NonNullable<Schemas['MarkRead']['category']>
export type NotificationAudience = 'personal' | 'admin' | 'all'

export interface Notification {
  notification_uuid: string
  org_id: number | null
  type: string
  category: NotificationCategory | (string & {})
  title: string
  body: string | null
  data: Record<string, unknown>
  image: string | null
  /** How many events were folded into this one (e.g. 3 new replies). */
  count: number
  read: boolean
  read_at: string | null
  created_at: string
  audience: 'personal' | 'admin'
  priority: 'normal' | 'important' | (string & {})
  important: boolean
  actor: Record<string, unknown> | null
  archived: boolean
  archived_at: string | null
  expires_at: string | null
  /** Where the notification points in the LearnHouse app, when anywhere. */
  path: string | null
  [key: string]: unknown
}

export interface NotificationPage {
  items: Notification[]
  /** Pass to `list({ cursor })` for the next page; null on the last one. */
  next_cursor: string | null
}

export interface NotificationUnread {
  unread_count: number
  unread_by_category: Record<string, number>
  unread_important: number
}

export type NotificationChange = NotificationUnread & { marked?: number; changed?: number }

// ---------------------------------------------------------------------------
// User groups

export interface UserGroupMembership {
  member_of: Array<Record<string, unknown> & { usergroup_uuid?: string; name?: string }>
  manages: Array<Record<string, unknown> & { usergroup_uuid: string; name: string }>
  managed_total: number
  features: Record<string, unknown>
}

export interface UserGroupJoinResult {
  status: 'joined' | 'already_member'
  usergroup_uuid: string
  name: string
  expires_at?: string | null
}

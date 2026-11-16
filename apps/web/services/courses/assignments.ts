import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export async function createAssignment(body: any, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateAssignment(
  body: any,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// Model answer ("corrigé") document for the whole assignment. Instructor only:
// the API withholds the stored filename from learners until the assignment's
// reveal rule unlocks it.
export async function updateAssignmentSolutionFile(
  file: any,
  assignmentUUID: string,
  access_token: string
) {
  const formData = new FormData()

  if (file) {
    formData.append('solution_file', file)
  }
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/solution_file`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteAssignmentSolutionFile(
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/solution_file`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentFromActivityUUID(
  activityUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/activity/${activityUUID}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// Delete an assignment
export async function deleteAssignment(
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteAssignmentUsingActivityUUID(
  activityUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/activity/${activityUUID}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// tasks

export async function createAssignmentTask(
  body: any,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentTask(
  assignmentTaskUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/task/${assignmentTaskUUID}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentTaskSubmissionsMe(
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/submissions/me`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentTaskSubmissionsUser(
  assignmentTaskUUID: string,
  user_id: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/submissions/user/${user_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function handleAssignmentTaskSubmission(
  body: any,
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/submissions`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateAssignmentTask(
  body: any,
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function reorderAssignmentTasks(
  taskUUIDs: string[],
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/order`,
    RequestBodyWithAuthHeader('PUT', { task_uuids: taskUUIDs }, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteAssignmentTask(
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateReferenceFile(
  file: any,
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()

  if (file) {
    formData.append('reference_file', file)
  }
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/ref_file`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateSubFile(
  file: any,
  assignmentTaskUUID: string,
  assignmentUUID: string,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()

  if (file) {
    formData.append('sub_file', file)
  }
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/tasks/${assignmentTaskUUID}/sub_file`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

// submissions

export async function submitAssignmentForGrading(
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteUserSubmission(
  user_id: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function putUserSubmission(
  body: any,
  user_id: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function putFinalGrade(
  user_id: string,
  assignmentUUID: string,
  access_token: string,
  overall_feedback?: string | null
) {
  // Only send a body when the caller actually passed feedback; otherwise the
  // backend leaves any existing note alone.
  const body =
    overall_feedback !== undefined && overall_feedback !== null
      ? { overall_feedback }
      : null
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/grade`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getFinalGrade(
  user_id: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/grade`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function retryAssignmentSubmission(
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/me/retry`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function markActivityAsDoneForUser(
  user_id: string,
  assignmentUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/done`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getAssignmentsFromACourse(
  courseUUID: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/course/${courseUUID}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export type MyAssignmentStatus = 'not_started' | 'in_progress' | 'submitted' | 'late' | 'graded'

export interface MyAssignment {
  assignment_uuid: string
  title: string
  activity_uuid: string
  course: { course_uuid: string; name: string; thumbnail_image?: string | null }
  due_date?: string | null
  status: MyAssignmentStatus
  attempt: number
  overdue: boolean
  ungraded: boolean
  grade?: { display_grade: string; percentage: number; passed: boolean } | null
  updated_at?: string | null
}

/** The signed-in learner's assignments in an org, open work first then the
 * most recently graded. Throws on errors (react-query surfaces them). */
export async function getMyAssignments(orgId: number, access_token: string, gradedLimit = 10): Promise<MyAssignment[]> {
  const result = await fetch(
    `${getAPIUrl()}assignments/me?org_id=${orgId}&graded_limit=${gradedLimit}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await errorHandling(result)
  return Array.isArray(res) ? res : []
}

// ── AI grading ────────────────────────────────────────────────────────────
// Grader-only endpoints. Every run reserves AI credits on the API (more for
// audio/video and long documents) and refunds them when grading fails.

export type AIGradeTask = {
  assignment_task_uuid: string
  title: string
  assignment_type: string
  score: number
  max_score: number
  feedback: string
  scored_by: 'ai' | 'checker'
  submitted: boolean
}

export type AIGrade = {
  assignment_ai_grade_uuid: string
  user_id: number
  status: 'DRAFT' | 'APPLIED' | 'DISCARDED' | 'FAILED'
  mode: 'SUGGEST' | 'AUTO'
  attempt_number: number
  overall_feedback?: string | null
  tasks: AIGradeTask[]
  confidence?: 'high' | 'medium' | 'low' | null
  notes?: string | null
  sources: Record<string, any>[]
  credits_charged: number
  error?: string | null
  creation_date: string
  update_date: string
}

export type AIGradingEstimate = {
  submissions: number
  credits: number
  estimated: boolean
  remaining_credits: number | string | null
  mode: 'OFF' | 'SUGGEST' | 'AUTO'
}

export type AIBulkResult = {
  graded: number
  drafted: number
  failed: number
  credits_used: number
  remaining: number
  stopped: 'no_credits' | 'rate_limited' | null
  stop_detail: string | null
}

export async function runAIGrade(user_id: string | number, assignmentUUID: string, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/ai-grade`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function getAIGrade(user_id: string | number, assignmentUUID: string, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/ai-grade`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function acceptAIGrade(
  user_id: string | number,
  assignmentUUID: string,
  access_token: string,
  edits?: { overall_feedback?: string; tasks?: { assignment_task_uuid: string; score?: number; feedback?: string }[] } | null
) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/ai-grade/accept`,
    RequestBodyWithAuthHeader('POST', edits ?? null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function discardAIGrade(user_id: string | number, assignmentUUID: string, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/submissions/${user_id}/ai-grade`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function estimateAIGrading(assignmentUUID: string, access_token: string, user_id?: string | number) {
  const query = user_id !== undefined ? `?user_id=${user_id}` : ''
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/ai-grading/estimate${query}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return getResponseMetadata(result)
}

export async function bulkAIGrade(assignmentUUID: string, access_token: string) {
  const result: any = await fetch(
    `${getAPIUrl()}assignments/${assignmentUUID}/ai-grading/bulk`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  return getResponseMetadata(result)
}

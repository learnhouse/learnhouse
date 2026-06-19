/**
 * API read-back helpers.
 *
 * The specs drive the feature through the UI, but they also assert the backend
 * persisted what we expect by reading the public REST API directly. That way a
 * failure tells us whether the UI lied or the server did — and we're testing
 * the real server state, not just rendered pixels.
 */
import { apiGet } from '../../core/client'

/** The current user's submission for an assignment (status + raw grade). */
export interface UserSubmission {
  submission_status: string
  grade: number
  attempt_number?: number
  [k: string]: unknown
}

/** `/submissions/me` returns an array (one row per attempt); take the latest. */
export async function getMySubmission(
  assignmentUuid: string,
  token: string,
): Promise<UserSubmission> {
  const data = await apiGet<UserSubmission | UserSubmission[]>(
    `/assignments/${assignmentUuid}/submissions/me`,
    token,
  )
  const row = Array.isArray(data) ? data[data.length - 1] : data
  if (!row) throw new Error('getMySubmission: no submission found')
  return row
}

/** A specific user's submission (teacher view). */
export async function getUserSubmission(
  assignmentUuid: string,
  userId: number | string,
  token: string,
): Promise<UserSubmission> {
  const data = await apiGet<UserSubmission | UserSubmission[]>(
    `/assignments/${assignmentUuid}/submissions/${userId}`,
    token,
  )
  const row = Array.isArray(data) ? data[data.length - 1] : data
  if (!row) throw new Error('getUserSubmission: no submission found')
  return row
}

/** The computed grade object for a user's submission (teacher view). */
export function getUserGrade(assignmentUuid: string, userId: number | string, token: string) {
  return apiGet<Record<string, unknown>>(
    `/assignments/${assignmentUuid}/submissions/${userId}/grade`,
    token,
  )
}

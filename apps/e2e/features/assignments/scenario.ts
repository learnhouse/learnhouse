/**
 * One-call scenario setup shared by the specs: as admin, create a published
 * course + assignment (with the given tasks) and a fresh student account.
 * Returns everything a spec needs to drive the student UI and verify via API.
 */
import * as api from './api'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../core/instance'
import { sharedStudent } from '../../core/sharedAuth'

export interface Scenario {
  adminToken: string
  org: api.Org
  seeded: api.SeededAssignment
  student: { email: string; username: string; password: string }
  studentId: number
  /** Bare UUIDs for the student activity URL (no course_/activity_ prefix). */
  bareCourseUuid: string
  bareActivityUuid: string
  /** Bare assignment uuid for the teacher dashboard URL. */
  bareAssignmentUuid: string
}

/**
 * Seed a scenario AND have the student submit the given per-task answers via
 * API, leaving a SUBMITTED (ungraded when auto_grading is off) submission ready
 * for the teacher to grade through the dashboard UI.
 */
export async function setupSubmittedScenario(
  label: string,
  opts: api.SeedAssignmentOptions,
  answers: Array<{ taskIndex: number; data: Record<string, unknown> }>,
): Promise<Scenario> {
  const s = await setupScenario(label, opts)
  const studentToken = await api.login(s.student.email, s.student.password)
  for (const a of answers) {
    await api.saveTaskSubmission(
      studentToken,
      s.seeded.assignmentUuid,
      s.seeded.taskUuids[a.taskIndex],
      a.data,
    )
  }
  await api.submitAssignment(studentToken, s.seeded.assignmentUuid)
  return s
}

// Cache the admin token across specs (workers: 1 ⇒ one process) so we don't
// re-login per spec — the API enforces 30 logins / 5 min / IP.
let cachedAdminToken: string | null = null

async function adminToken(): Promise<string> {
  if (!cachedAdminToken) {
    cachedAdminToken = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  }
  return cachedAdminToken
}

export async function setupScenario(
  label: string,
  opts: api.SeedAssignmentOptions,
): Promise<Scenario> {
  const token = await adminToken()
  const org = await api.getOrg()
  const seeded = await api.seedAssignment(token, org, opts)
  // Reuse the single shared student (created in global-setup) so specs share
  // one authenticated session via storageState — keeps the suite far under the
  // login rate limit. `label` is kept for call-site readability only.
  void label
  const shared = sharedStudent()
  const student = { email: shared.email, username: shared.username, password: shared.password }
  const studentId = shared.id
  return {
    adminToken: token,
    org,
    seeded,
    student,
    studentId,
    bareCourseUuid: seeded.courseUuid.replace(/^course_/, ''),
    bareActivityUuid: seeded.activityUuid.replace(/^activity_/, ''),
    bareAssignmentUuid: seeded.assignmentUuid.replace(/^assignment_/, ''),
  }
}

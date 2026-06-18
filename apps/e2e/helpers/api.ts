/**
 * REST API client used to SEED preconditions for the UI tests.
 *
 * The assignments *feature* (taking an assignment, auto-grading, teacher
 * grading) is exercised through the UI by the specs. The generic LMS
 * scaffolding it needs — a course, a chapter, an assignment activity, the
 * tasks, a published state, and a student account — is created here via the
 * documented API so the specs stay fast and aren't defeated by unrelated
 * authoring-UI churn. Field names mirror the backend Create models exactly
 * (snake_case); see apps/api/src/db/courses/assignments.py.
 */
import { API_URL, ORG_SLUG } from './instance'

// Re-export the API read-back helpers so specs have a single import surface.
export { getMySubmission, getUserSubmission, getUserGrade } from './verify'
export type { UserSubmission } from './verify'

export interface Org {
  id: number
  slug: string
}

export interface Ids {
  org: Org
  courseId: number
  courseUuid: string
  chapterId: number
  activityId: number
  activityUuid: string
  assignmentUuid: string
}

async function req<T = any>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  asForm = false,
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (asForm) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(body as Record<string, string>)
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: payload })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

// Cache API tokens per email so repeated read-backs / seeds for the same user
// don't each spend a login — the API enforces 30 logins / 5 min / IP.
const _tokenCache = new Map<string, string>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function login(email: string, password: string): Promise<string> {
  const cached = _tokenCache.get(email)
  if (cached) return cached
  // Retry once on a transient IP rate-limit (429) rather than failing the test.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await req<any>('POST', '/auth/login', null, { username: email, password }, true)
      const token = data?.tokens?.access_token || data?.access_token
      if (!token) throw new Error('login: no access_token')
      _tokenCache.set(email, token)
      return token
    } catch (e) {
      if (attempt === 0 && /-> 429/.test((e as Error).message)) {
        await sleep(8000)
        continue
      }
      throw e
    }
  }
  throw new Error(`login failed for ${email}`)
}

export async function getOrg(): Promise<Org> {
  return req<Org>('GET', `/orgs/slug/${ORG_SLUG}`, null)
}

/** Create a course. The endpoint expects multipart form fields + ?org_id=. */
async function createCourse(token: string, orgId: number, name: string): Promise<any> {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('description', 'Seeded by E2E')
  fd.set('public', 'true')
  fd.set('about', 'Seeded by E2E')
  fd.set('learnings', '[]')
  fd.set('tags', '')
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

/** Create a student account attached to the org. Returns the new user id. */
export async function createStudent(
  adminToken: string,
  orgId: number,
  student: { email: string; username: string; password: string; first_name?: string; last_name?: string },
): Promise<number> {
  const user = await req<any>('POST', `/users/${orgId}`, adminToken, {
    email: student.email,
    username: student.username,
    password: student.password,
    first_name: student.first_name ?? '',
    last_name: student.last_name ?? '',
  })
  return user.id
}

export interface TaskSpec {
  title: string
  assignment_type: 'QUIZ' | 'SHORT_ANSWER' | 'NUMBER_ANSWER' | 'FORM'
  contents: Record<string, unknown>
  description?: string
  hint?: string
  max_grade_value?: number
}

export interface SeedAssignmentOptions {
  courseName: string
  assignmentTitle: string
  tasks: TaskSpec[]
  gradingType?: 'NUMERIC' | 'PERCENTAGE' | 'ALPHABET' | 'PASS_FAIL' | 'GPA_SCALE'
  autoGrading?: boolean
  showCorrectAnswers?: boolean
  allowRetries?: boolean
  maxRetries?: number
  antiCopyPaste?: boolean
}

export interface SeededAssignment extends Ids {
  taskUuids: string[]
}

/**
 * Create a published course → chapter → assignment activity → assignment with
 * the given tasks, all via API. Returns every id/uuid the UI specs need.
 */
export async function seedAssignment(
  adminToken: string,
  org: Org,
  opts: SeedAssignmentOptions,
): Promise<SeededAssignment> {
  // 1. Course — the create endpoint takes multipart form fields + org_id query param.
  const course = await createCourse(adminToken, org.id, opts.courseName)
  const courseId = course.id
  const courseUuid = course.course_uuid

  // 2. Chapter
  const chapter = await req<any>('POST', '/chapters/', adminToken, {
    name: 'Chapter 1',
    description: '',
    org_id: org.id,
    course_id: courseId,
  })
  const chapterId = chapter.id

  // 3. Assignment activity inside the chapter
  const activity = await req<any>(
    'POST',
    `/activities/?coursechapter_id=${chapterId}&org_id=${org.id}`,
    adminToken,
    {
      name: opts.assignmentTitle,
      activity_type: 'TYPE_ASSIGNMENT',
      activity_sub_type: 'SUBTYPE_ASSIGNMENT_ANY',
      chapter_id: chapterId,
      published: true,
    },
  )
  const activityId = activity.id
  const activityUuid = activity.activity_uuid

  // 4. Assignment linked to the activity
  const assignment = await req<any>('POST', '/assignments/', adminToken, {
    title: opts.assignmentTitle,
    description: 'Seeded by E2E',
    due_date: '2099-12-31',
    published: true,
    grading_type: opts.gradingType ?? 'NUMERIC',
    anti_copy_paste: opts.antiCopyPaste ?? false,
    auto_grading: opts.autoGrading ?? true,
    show_correct_answers: opts.showCorrectAnswers ?? true,
    allow_retries: opts.allowRetries ?? false,
    max_retries: opts.maxRetries ?? 0,
    org_id: org.id,
    course_id: courseId,
    chapter_id: chapterId,
    activity_id: activityId,
  })
  const assignmentUuid = assignment.assignment_uuid

  // 5. Tasks
  const taskUuids: string[] = []
  for (const t of opts.tasks) {
    const task = await req<any>('POST', `/assignments/${assignmentUuid}/tasks`, adminToken, {
      title: t.title,
      description: t.description ?? t.title,
      hint: t.hint ?? '',
      reference_file: null,
      assignment_type: t.assignment_type,
      max_grade_value: t.max_grade_value ?? 100,
      contents: t.contents,
    })
    taskUuids.push(task.assignment_task_uuid)
  }

  // 6. Publish the assignment + course so a student can reach it
  await req('PUT', `/assignments/${assignmentUuid}`, adminToken, { published: true })
  await req('PUT', `/courses/${courseUuid}`, adminToken, { public: true, published: true }).catch(
    () => {/* publish shape varies; activity+assignment published is what matters */},
  )

  return {
    org,
    courseId,
    courseUuid,
    chapterId,
    activityId,
    activityUuid,
    assignmentUuid,
    taskUuids,
  }
}

/** Set an assignment's published flag (PUT). */
export async function setPublished(
  token: string,
  assignmentUuid: string,
  published: boolean,
): Promise<void> {
  await req('PUT', `/assignments/${assignmentUuid}`, token, { published })
}

/** Read an assignment's current config (grading_type, published, …). */
export async function getAssignment(token: string, assignmentUuid: string): Promise<any> {
  return req('GET', `/assignments/${assignmentUuid}`, token)
}

/** Count the tasks on an assignment. */
export async function getTaskCount(token: string, assignmentUuid: string): Promise<number> {
  const tasks = await req<any[]>('GET', `/assignments/${assignmentUuid}/tasks`, token)
  return Array.isArray(tasks) ? tasks.length : 0
}

/** Enable retries on an assignment (PUT). */
export async function enableRetries(
  token: string,
  assignmentUuid: string,
  maxRetries = 0,
): Promise<void> {
  await req('PUT', `/assignments/${assignmentUuid}`, token, {
    allow_retries: true,
    max_retries: maxRetries,
  })
}

/** Save a student's answer for one task (PUT .../tasks/{uuid}/submissions). */
export async function saveTaskSubmission(
  token: string,
  assignmentUuid: string,
  taskUuid: string,
  taskSubmission: Record<string, unknown>,
): Promise<void> {
  await req(
    'PUT',
    `/assignments/${assignmentUuid}/tasks/${taskUuid}/submissions`,
    token,
    { task_submission: taskSubmission },
  )
}

/** Start/submit the overall assignment (POST .../submissions). */
export async function submitAssignment(token: string, assignmentUuid: string): Promise<void> {
  await req('POST', `/assignments/${assignmentUuid}/submissions`, token, {})
}

/** Reset the current user's graded submission for another attempt (POST .../submissions/me/retry). */
export async function retryMe(token: string, assignmentUuid: string): Promise<void> {
  await req('POST', `/assignments/${assignmentUuid}/submissions/me/retry`, token, {})
}

/** Upload a teacher reference file to a task (multipart field "reference_file"). */
export async function uploadTaskRefFile(
  token: string,
  assignmentUuid: string,
  taskUuid: string,
  bytes: Uint8Array,
  filename = 'reference.png',
  contentType = 'image/png',
): Promise<void> {
  const fd = new FormData()
  fd.set('reference_file', new Blob([bytes as unknown as BlobPart], { type: contentType }), filename)
  const res = await fetch(`${API_URL}/assignments/${assignmentUuid}/tasks/${taskUuid}/ref_file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  if (!res.ok) throw new Error(`uploadTaskRefFile -> ${res.status}: ${await res.text()}`)
}

/** Submission-data builders mirroring what each student task component posts. */
export const SubmissionData = {
  quiz: (checked: Record<string, boolean>) => ({
    submissions: Object.entries(checked).map(([optionUUID, answer]) => ({
      questionUUID: 'q1',
      optionUUID,
      answer,
    })),
  }),
  shortAnswer: (answer: string) => ({ answer }),
  number: (answer: string) => ({ answer }),
  form: (answer: string) => ({
    submissions: [{ questionUUID: 'q1', blankUUID: 'b1', answer }],
  }),
}

/** Convenience task-content builders matching the frontend contents schema. */
export const TaskContents = {
  quiz: (rightOption = 'a') => ({
    questions: [
      {
        questionUUID: 'q1',
        options: [
          { optionUUID: 'a', assigned_right_answer: rightOption === 'a' },
          { optionUUID: 'b', assigned_right_answer: rightOption === 'b' },
        ],
      },
    ],
  }),
  shortAnswer: (answers: string[], match_mode = 'case_insensitive') => ({
    correct_answers: answers,
    match_mode,
  }),
  number: (correct_value: number, tolerance = 0) => ({ correct_value, tolerance }),
  form: (correct: string) => ({
    questions: [{ questionUUID: 'q1', blanks: [{ blankUUID: 'b1', correctAnswer: correct }] }],
  }),
}

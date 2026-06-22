/**
 * Assignments feature API — seeds the preconditions the UI specs need
 * (course → chapter → assignment activity → tasks, plus submissions/grading)
 * via the documented REST API. Builds on the generic client in core/.
 * Field names mirror the backend Create models (snake_case); see
 * apps/api/src/db/courses/assignments.py.
 */
import { req } from '../../core/client'
import type { Org } from '../../core/client'
import { API_URL } from '../../core/instance'

// Single import surface for specs: re-export generic client bits + read-backs.
export { login, getOrg, createStudent } from '../../core/client'
export type { Org } from '../../core/client'
export { getMySubmission, getUserSubmission, getUserGrade } from './verify'
export type { UserSubmission } from './verify'

export interface Ids {
  org: Org
  courseId: number
  courseUuid: string
  chapterId: number
  activityId: number
  activityUuid: string
  assignmentUuid: string
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
  const course = await createCourse(adminToken, org.id, opts.courseName)
  const courseId = course.id
  const courseUuid = course.course_uuid

  const chapter = await req<any>('POST', '/chapters/', adminToken, {
    name: 'Chapter 1',
    description: '',
    org_id: org.id,
    course_id: courseId,
  })
  const chapterId = chapter.id

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

  // Publish the assignment + course so a student can reach it.
  await req('PUT', `/assignments/${assignmentUuid}`, adminToken, { published: true })
  await req('PUT', `/courses/${courseUuid}`, adminToken, { public: true, published: true }).catch(
    () => {/* publish shape varies; activity+assignment published is what matters */},
  )

  return { org, courseId, courseUuid, chapterId, activityId, activityUuid, assignmentUuid, taskUuids }
}

/** Set an assignment's published flag (PUT). */
export async function setPublished(token: string, assignmentUuid: string, published: boolean): Promise<void> {
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
export async function enableRetries(token: string, assignmentUuid: string, maxRetries = 0): Promise<void> {
  await req('PUT', `/assignments/${assignmentUuid}`, token, { allow_retries: true, max_retries: maxRetries })
}

/** Save a student's answer for one task (PUT .../tasks/{uuid}/submissions). */
export async function saveTaskSubmission(
  token: string,
  assignmentUuid: string,
  taskUuid: string,
  taskSubmission: Record<string, unknown>,
): Promise<void> {
  await req('PUT', `/assignments/${assignmentUuid}/tasks/${taskUuid}/submissions`, token, {
    task_submission: taskSubmission,
  })
}

/** Start/submit the overall assignment (POST .../submissions). */
export async function submitAssignment(token: string, assignmentUuid: string): Promise<void> {
  await req('POST', `/assignments/${assignmentUuid}/submissions`, token, {})
}

/** Reset the current user's graded submission for another attempt. */
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
  form: (answer: string) => ({ submissions: [{ questionUUID: 'q1', blankUUID: 'b1', answer }] }),
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
  shortAnswer: (answers: string[], match_mode = 'case_insensitive') => ({ correct_answers: answers, match_mode }),
  number: (correct_value: number, tolerance = 0) => ({ correct_value, tolerance }),
  form: (correct: string) => ({
    questions: [{ questionUUID: 'q1', blanks: [{ blankUUID: 'b1', correctAnswer: correct }] }],
  }),
}

import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import { appendFile, type UploadFile } from '../core/upload'
import type {
  Assignment,
  AssignmentGrade,
  AssignmentRetry,
  AssignmentSubmission,
  AssignmentTask,
  AssignmentTaskSubmission,
  AssignmentTaskSubmissionInput,
  MyAssignment,
} from '../models'

export interface AssignmentLangOptions extends BaseRequestOptions {
  /** Read the assignment in one of its course's translated languages (e.g. `fr`). */
  lang?: string
}

export interface OnBehalfOptions extends BaseRequestOptions {
  /**
   * API tokens only (`assignments: create`): act for this learner (their
   * LearnHouse user id; they must belong to the token's organization).
   * Sessions always act for themselves and must leave it unset.
   */
  onBehalfOfUserId?: number
}

export interface UploadTaskFileOptions extends BaseRequestOptions {
  /** File name for a Blob that has none. Default `submission`. */
  filename?: string
}

/**
 * Assignments from the learner's side: read the assignment and its tasks,
 * save answers, upload files, submit, see the grade and retry. An API token
 * with `assignments` rights can also read them and submit for a learner
 * (`onBehalfOfUserId`); authoring and grading are covered by the typed
 * `lh.POST(...)` / `lh.PUT(...)` calls (see "Headless assignments").
 */
export function createAssignmentsResource(http: HttpCore) {
  return {
    /**
     * The signed-in learner's assignments in an org, with status and grade.
     * Sessions only. `GET /api/v1/assignments/me`
     */
    listMine(orgId: number, options: BaseRequestOptions & { gradedLimit?: number } = {}): Promise<MyAssignment[]> {
      const { gradedLimit, ...rest } = options
      return http.GET('/api/v1/assignments/me', {
        ...rest,
        params: { query: { org_id: orgId, graded_limit: gradedLimit } },
      })
    },
    /** Every assignment of a course. `GET /api/v1/assignments/course/{course_uuid}` */
    listForCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Assignment[]> {
      return http.GET('/api/v1/assignments/course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      }) as Promise<Assignment[]>
    },
    /** `GET /api/v1/assignments/{assignment_uuid}` */
    get(assignmentUuid: string, options: AssignmentLangOptions = {}): Promise<Assignment> {
      const { lang, ...rest } = options
      return http.GET('/api/v1/assignments/{assignment_uuid}', {
        ...rest,
        params: { path: { assignment_uuid: assignmentUuid }, query: { lang } },
      })
    },
    /**
     * The assignment behind an assignment activity (activity type
     * `TYPE_ASSIGNMENT`). `GET /api/v1/assignments/activity/{activity_uuid}`
     */
    getForActivity(activityUuid: string, options: AssignmentLangOptions = {}): Promise<Assignment> {
      const { lang, ...rest } = options
      return http.GET('/api/v1/assignments/activity/{activity_uuid}', {
        ...rest,
        params: { path: { activity_uuid: activityUuid }, query: { lang } },
      })
    },
    /** Tasks in order. `GET /api/v1/assignments/{assignment_uuid}/tasks` */
    listTasks(assignmentUuid: string, options: AssignmentLangOptions = {}): Promise<AssignmentTask[]> {
      const { lang, ...rest } = options
      return http.GET('/api/v1/assignments/{assignment_uuid}/tasks', {
        ...rest,
        params: { path: { assignment_uuid: assignmentUuid }, query: { lang } },
      }) as Promise<AssignmentTask[]>
    },
    /** `GET /api/v1/assignments/task/{assignment_task_uuid}` */
    getTask(taskUuid: string, options?: BaseRequestOptions): Promise<AssignmentTask> {
      return http.GET('/api/v1/assignments/task/{assignment_task_uuid}', {
        ...options,
        params: { path: { assignment_task_uuid: taskUuid } },
      }) as Promise<AssignmentTask>
    },
    /**
     * The signed-in learner's answers to every task, keyed by task uuid
     * (`null` for a task not answered yet). Sessions only.
     * `GET /api/v1/assignments/{assignment_uuid}/tasks/submissions/me`
     */
    getMyTaskSubmissions(
      assignmentUuid: string,
      options?: BaseRequestOptions,
    ): Promise<Record<string, AssignmentTaskSubmission | null>> {
      return http.GET('/api/v1/assignments/{assignment_uuid}/tasks/submissions/me', {
        ...options,
        params: { path: { assignment_uuid: assignmentUuid } },
      }) as Promise<Record<string, AssignmentTaskSubmission | null>>
    },
    /**
     * The signed-in learner's answer to one task. 404 when there is none yet.
     * `GET /api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/me`
     */
    getMyTaskSubmission(assignmentUuid: string, taskUuid: string, options?: BaseRequestOptions): Promise<AssignmentTaskSubmission> {
      return http.request<AssignmentTaskSubmission>(
        'GET',
        '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/me',
        { ...options, params: { path: { assignment_uuid: assignmentUuid, assignment_task_uuid: taskUuid } } },
      )
    },
    /**
     * Save (create or update) an answer to one task. Answers can be saved any
     * number of times until `submit()`. For file tasks, upload first with
     * `uploadTaskFile()` and save `{ fileUUID }`.
     * `PUT /api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions`
     */
    saveTaskSubmission(
      assignmentUuid: string,
      taskUuid: string,
      input: AssignmentTaskSubmissionInput,
      options: OnBehalfOptions = {},
    ): Promise<AssignmentTaskSubmission> {
      const { onBehalfOfUserId, ...rest } = options
      const body: Record<string, unknown> = { task_submission: input.taskSubmission }
      if (input.submissionUuid) body.assignment_task_submission_uuid = input.submissionUuid
      return http.request<AssignmentTaskSubmission>(
        'PUT',
        '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions',
        {
          ...rest,
          params: {
            path: { assignment_uuid: assignmentUuid, assignment_task_uuid: taskUuid },
            query: { on_behalf_of_user_id: onBehalfOfUserId },
          },
          body,
        },
      )
    },
    /**
     * Upload the file for a file task. Returns the stored file's id; save it
     * as the answer with `saveTaskSubmission(…, { taskSubmission: { fileUUID } })`.
     * Rate limited per user. Sessions only.
     * `POST /api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/sub_file`
     */
    uploadTaskFile(
      assignmentUuid: string,
      taskUuid: string,
      file: UploadFile,
      options: UploadTaskFileOptions = {},
    ): Promise<{ file_uuid: string }> {
      const { filename, ...rest } = options
      const form = new FormData()
      appendFile(form, 'sub_file', file, filename ?? 'submission')
      return http.request<{ file_uuid: string }>(
        'POST',
        '/api/v1/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/sub_file',
        { ...rest, params: { path: { assignment_uuid: assignmentUuid, assignment_task_uuid: taskUuid } }, body: form },
      )
    },
    /**
     * Hand the assignment in. Auto-graded tasks are graded now; the rest wait
     * for the teacher. `POST /api/v1/assignments/{assignment_uuid}/submissions`
     */
    submit(assignmentUuid: string, options: OnBehalfOptions = {}): Promise<AssignmentSubmission> {
      const { onBehalfOfUserId, ...rest } = options
      return http.POST('/api/v1/assignments/{assignment_uuid}/submissions', {
        ...rest,
        params: { path: { assignment_uuid: assignmentUuid }, query: { on_behalf_of_user_id: onBehalfOfUserId } },
      }) as Promise<AssignmentSubmission>
    },
    /**
     * The signed-in learner's submission, as a list (empty before the first
     * `submit()`). Sessions only.
     * `GET /api/v1/assignments/{assignment_uuid}/submissions/me`
     */
    getMySubmission(assignmentUuid: string, options?: BaseRequestOptions): Promise<AssignmentSubmission[]> {
      return http.GET('/api/v1/assignments/{assignment_uuid}/submissions/me', {
        ...options,
        params: { path: { assignment_uuid: assignmentUuid } },
      }) as Promise<AssignmentSubmission[]>
    },
    /**
     * A submission's grade with per-task scores and feedback. Learners may read
     * their own (`userId` = their id); teachers and API tokens anyone's.
     * `GET /api/v1/assignments/{assignment_uuid}/submissions/{user_id}/grade`
     */
    getGrade(assignmentUuid: string, userId: number, options?: BaseRequestOptions): Promise<AssignmentGrade> {
      return http.GET('/api/v1/assignments/{assignment_uuid}/submissions/{user_id}/grade', {
        ...options,
        params: { path: { assignment_uuid: assignmentUuid, user_id: userId } },
      }) as Promise<AssignmentGrade>
    },
    /**
     * Start another attempt after a graded one, when the assignment allows
     * retries. Clears the task answers. Sessions only.
     * `POST /api/v1/assignments/{assignment_uuid}/submissions/me/retry`
     */
    retry(assignmentUuid: string, options?: BaseRequestOptions): Promise<AssignmentRetry> {
      return http.POST('/api/v1/assignments/{assignment_uuid}/submissions/me/retry', {
        ...options,
        params: { path: { assignment_uuid: assignmentUuid } },
      }) as Promise<AssignmentRetry>
    },
  }
}

export type AssignmentsResource = ReturnType<typeof createAssignmentsResource>

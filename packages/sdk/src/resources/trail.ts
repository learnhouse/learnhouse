import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { CourseProgress, Trail } from '../models'
import { courseProgress, type CourseKey } from '../progress'

/**
 * A trail is a user's progress record: one run per enrolled course, one step
 * per completed activity.
 */
export function createTrailResource(http: HttpCore) {
  const resource = {
    /** The current user's trail across orgs. `GET /api/v1/trail/` */
    get(options?: BaseRequestOptions): Promise<Trail> {
      return http.GET('/api/v1/trail/', options)
    },
    /** The current user's trail in one org. `GET /api/v1/trail/org/{org_id}/trail` */
    getForOrg(orgId: number, options?: BaseRequestOptions): Promise<Trail> {
      return http.GET('/api/v1/trail/org/{org_id}/trail', {
        ...options,
        params: { path: { org_id: orgId } },
      })
    },
    /**
     * Enroll the current user in a course (start it). Answers 400
     * (`TrailRun already exists`) when they already are: check
     * `courseProgress(trail, course).enrolled` first, or treat that 400 as done.
     * `POST /api/v1/trail/add_course/{course_uuid}`
     */
    startCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Trail> {
      return http.POST('/api/v1/trail/add_course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      })
    },
    /**
     * Leave a course: removes its run and every completion step in it.
     * `DELETE /api/v1/trail/remove_course/{course_uuid}`
     */
    leaveCourse(courseUuid: string, options?: BaseRequestOptions): Promise<Trail> {
      return http.DELETE('/api/v1/trail/remove_course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      })
    },
    /**
     * Mark an activity complete (same call as the web app's "Mark as complete").
     * Assignments are refused: they complete through submission.
     * `POST /api/v1/trail/add_activity/{activity_uuid}`
     */
    completeActivity(activityUuid: string, options?: BaseRequestOptions): Promise<Trail> {
      return http.POST('/api/v1/trail/add_activity/{activity_uuid}', {
        ...options,
        params: { path: { activity_uuid: activityUuid } },
      })
    },
    /** `DELETE /api/v1/trail/remove_activity/{activity_uuid}` */
    uncompleteActivity(activityUuid: string, options?: BaseRequestOptions): Promise<Trail> {
      return http.DELETE('/api/v1/trail/remove_activity/{activity_uuid}', {
        ...options,
        params: { path: { activity_uuid: activityUuid } },
      })
    },
    /**
     * The current user's progress in one course: `getForOrg(orgId)`, then
     * `courseProgress()` on the result. `course` is the course's numeric id or
     * its uuid.
     */
    async getCourseProgress(orgId: number, course: CourseKey, options?: BaseRequestOptions): Promise<CourseProgress> {
      return courseProgress(await resource.getForOrg(orgId, options), course)
    },
  }
  return resource
}

export type TrailResource = ReturnType<typeof createTrailResource>

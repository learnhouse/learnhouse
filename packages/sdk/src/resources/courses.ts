import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { Course, CourseMeta } from '../models'

export interface ListCoursesOptions extends BaseRequestOptions {
  /** 1-based. Default 1. */
  page?: number
  /** Default 20. */
  limit?: number
  /** Include unpublished courses (only honoured for users who may see them). */
  includeUnpublished?: boolean
}

export interface CourseMetaOptions extends BaseRequestOptions {
  /** Leave out heavy activity content/details; enough for navigation. */
  slim?: boolean
  /** Include unpublished activities (only honoured for users who may edit the course). */
  withUnpublishedActivities?: boolean
}

export function createCoursesResource(http: HttpCore) {
  return {
    /** `GET /api/v1/courses/org_slug/{org_slug}/page/{page}/limit/{limit}` */
    list(orgSlug: string, options: ListCoursesOptions = {}): Promise<Course[]> {
      const { page = 1, limit = 20, includeUnpublished, ...rest } = options
      return http.GET('/api/v1/courses/org_slug/{org_slug}/page/{page}/limit/{limit}', {
        ...rest,
        params: {
          path: { org_slug: orgSlug, page, limit },
          query: includeUnpublished === undefined ? undefined : { include_unpublished: includeUnpublished },
        },
      })
    },
    /** `GET /api/v1/courses/org_slug/{org_slug}/count` */
    count(orgSlug: string, options?: BaseRequestOptions): Promise<number> {
      return http.GET('/api/v1/courses/org_slug/{org_slug}/count', {
        ...options,
        params: { path: { org_slug: orgSlug } },
      })
    },
    /** `GET /api/v1/courses/{course_uuid}` */
    get(courseUuid: string, options?: BaseRequestOptions): Promise<Course> {
      return http.GET('/api/v1/courses/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      })
    },
    /** Course with chapters and activities. `GET /api/v1/courses/{course_uuid}/meta` */
    getMeta(courseUuid: string, options: CourseMetaOptions = {}): Promise<CourseMeta> {
      const { slim, withUnpublishedActivities, ...rest } = options
      return http.GET('/api/v1/courses/{course_uuid}/meta', {
        ...rest,
        params: {
          path: { course_uuid: courseUuid },
          query: { slim, with_unpublished_activities: withUnpublishedActivities },
        },
      })
    },
  }
}

export type CoursesResource = ReturnType<typeof createCoursesResource>

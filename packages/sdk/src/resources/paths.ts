import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { LearningPath } from '../models'

/** Learning paths: ordered sets of courses with an optional certificate (Pro plan on Cloud). */
export function createPathsResource(http: HttpCore) {
  return {
    /** Published paths of an org. `GET /api/v1/paths/org/{org_id}` */
    list(orgId: number, options?: BaseRequestOptions): Promise<LearningPath[]> {
      return http.GET('/api/v1/paths/org/{org_id}', { ...options, params: { path: { org_id: orgId } } })
    },
    /** Paths the signed-in user is enrolled in, with their `progress`. `GET /api/v1/paths/me/org/{org_id}` */
    listMine(orgId: number, options?: BaseRequestOptions): Promise<LearningPath[]> {
      return http.GET('/api/v1/paths/me/org/{org_id}', { ...options, params: { path: { org_id: orgId } } })
    },
    /** Paths that include a course. `GET /api/v1/paths/course/{course_uuid}` */
    listForCourse(courseUuid: string, options?: BaseRequestOptions): Promise<LearningPath[]> {
      return http.GET('/api/v1/paths/course/{course_uuid}', {
        ...options,
        params: { path: { course_uuid: courseUuid } },
      })
    },
    /** A path with its courses (and the caller's progress when signed in). `GET /api/v1/paths/{path_uuid}` */
    get(pathUuid: string, options?: BaseRequestOptions): Promise<LearningPath> {
      return http.GET('/api/v1/paths/{path_uuid}', { ...options, params: { path: { path_uuid: pathUuid } } })
    },
    /** Enroll the signed-in user. `POST /api/v1/paths/{path_uuid}/enroll` */
    enroll(pathUuid: string, options?: BaseRequestOptions): Promise<LearningPath> {
      return http.POST('/api/v1/paths/{path_uuid}/enroll', { ...options, params: { path: { path_uuid: pathUuid } } })
    },
    /** `DELETE /api/v1/paths/{path_uuid}/enroll` */
    leave(pathUuid: string, options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.DELETE('/api/v1/paths/{path_uuid}/enroll', { ...options, params: { path: { path_uuid: pathUuid } } })
    },
    /** Path certificates the signed-in user earned. `GET /api/v1/paths/certificates/me` */
    listMyCertificates(options?: BaseRequestOptions): Promise<Record<string, unknown>[]> {
      return http.GET('/api/v1/paths/certificates/me', options)
    },
    /** One path certificate, for verification. Public. `GET /api/v1/paths/certificates/{certificate_uuid}` */
    getCertificate(certificateUuid: string, options?: BaseRequestOptions): Promise<Record<string, unknown>> {
      return http.GET('/api/v1/paths/certificates/{certificate_uuid}', {
        ...options,
        params: { path: { certificate_uuid: certificateUuid } },
      })
    },
  }
}

export type PathsResource = ReturnType<typeof createPathsResource>

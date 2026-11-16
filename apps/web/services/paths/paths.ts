import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 Learning paths: an ordered set of courses that awards its own certificate.
 Reads are fetched with TanStack Query (hooks/queries/usePaths.ts).
*/

export type PathLevel = '' | 'beginner' | 'intermediate' | 'advanced'

export interface PathCertificateConfig {
  certification_name?: string
  certification_description?: string
  certification_type?: string
  certificate_pattern?: string
  certificate_instructor?: string
}

export interface PathCourseCard {
  id?: number
  course_uuid: string
  slug?: string | null
  org_id?: number
  name?: string
  description?: string
  thumbnail_image?: string
  thumbnail_type?: string
  thumbnail_video?: string
  public?: boolean
  published?: boolean
  update_date?: string
  restricted?: boolean
}

export interface PathCourseItem {
  course_uuid: string
  position: number
  required: boolean
  course: PathCourseCard
  completed: boolean
  progress: number
  started: boolean
  locked: boolean
}

export interface PathProgress {
  enrolled: boolean
  enrolled_at: string | null
  completed: boolean
  completed_at: string | null
  required_total: number
  required_done: number
  electives_done: number
  courses_needed: number
  courses_done: number
  percent: number
  certificate_uuid: string | null
  certificate_revoked: boolean
}

export interface Path {
  id: number
  org_id: number
  path_uuid: string
  /** Human-readable URL key, unique per org. */
  slug?: string | null
  seo?: Record<string, any> | null
  name: string
  description: string
  about: string
  thumbnail_image: string
  level: PathLevel
  public: boolean
  published: boolean
  sequential: boolean
  electives_required: number
  certificate_enabled: boolean
  certificate_config: PathCertificateConfig
  creation_date: string
  update_date: string
  course_count: number
  enrollment_count: number
  courses: PathCourseItem[]
  progress: PathProgress | null
}

export interface PathLearner {
  user: {
    id: number
    user_uuid: string
    username: string
    first_name: string
    last_name: string
    email: string
    avatar_image: string
  }
  enrolled_at: string
  completed_at: string | null
  required_done: number
  required_total: number
  courses_needed: number
  courses_done: number
  percent: number
  certificate_uuid: string | null
  certificate_revoked: boolean
}

export interface PathCertificateRecord {
  certificate: { certificate_uuid: string; created_at: string }
  path: {
    path_uuid: string
    name: string
    description: string
    thumbnail_image: string
    level: PathLevel
    certificate_config: PathCertificateConfig
    courses: { course_uuid: string; name: string; required: boolean }[]
  }
  user: { user_uuid: string; username: string; first_name: string; last_name: string }
  org: { org_uuid: string; name: string; slug: string }
}

export function removePathPrefix(pathUuid: string) {
  return pathUuid.replace(/^path_/, '')
}

export async function getOrgPaths(orgId: number, accessToken?: string, next: any = null): Promise<Path[]> {
  const res = await fetch(
    `${getAPIUrl()}paths/org/${orgId}?org_id=${orgId}`,
    RequestBodyWithAuthHeader('GET', null, next, accessToken)
  )
  return errorHandling(res)
}

export async function getPath(pathUuid: string, accessToken?: string, next: any = null): Promise<Path> {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}`,
    RequestBodyWithAuthHeader('GET', null, next, accessToken)
  )
  return errorHandling(res)
}

export async function getMyPaths(orgId: number, accessToken: string): Promise<Path[]> {
  const res = await fetch(
    `${getAPIUrl()}paths/me/org/${orgId}?org_id=${orgId}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function getPathsForCourse(courseUuid: string, accessToken?: string): Promise<Path[]> {
  const res = await fetch(
    `${getAPIUrl()}paths/course/${courseUuid}`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return errorHandling(res)
}

/** Resolves to `getResponseMetadata` so callers can route plan-limit 403s. */
export async function createPath(
  orgId: number,
  body: { name: string; description?: string; public?: boolean },
  accessToken: string
) {
  const res = await fetch(
    `${getAPIUrl()}paths/?org_id=${orgId}`,
    RequestBodyWithAuthHeader('POST', { org_id: orgId, ...body }, null, accessToken)
  )
  return getResponseMetadata(res)
}

export async function updatePath(
  pathUuid: string,
  body: Partial<Omit<Path, 'courses' | 'progress'>>,
  accessToken: string
): Promise<Path> {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}`,
    RequestBodyWithAuthHeader('PUT', body, null, accessToken)
  )
  return errorHandling(res)
}

export async function setPathCourses(
  pathUuid: string,
  courses: { course_uuid: string; required: boolean }[],
  accessToken: string
): Promise<Path> {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/courses`,
    RequestBodyWithAuthHeader('PUT', { courses }, null, accessToken)
  )
  return errorHandling(res)
}

export async function updatePathThumbnail(pathUuid: string, file: File, accessToken: string) {
  const formData = new FormData()
  formData.append('thumbnail', file)
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, accessToken)
  )
  return errorHandling(res)
}

export async function deletePath(pathUuid: string, accessToken: string) {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function enrollInPath(pathUuid: string, accessToken: string): Promise<Path> {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/enroll`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function leavePath(pathUuid: string, accessToken: string) {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/enroll`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function getPathLearners(pathUuid: string, accessToken: string): Promise<PathLearner[]> {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/learners`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function revokePathCertificate(pathUuid: string, certificateUuid: string, accessToken: string) {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/certificates/${certificateUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function reinstatePathCertificate(pathUuid: string, certificateUuid: string, accessToken: string) {
  const res = await fetch(
    `${getAPIUrl()}paths/${pathUuid}/certificates/${certificateUuid}/reinstate`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function getPathCertificate(certificateUuid: string): Promise<PathCertificateRecord> {
  const res = await fetch(
    `${getAPIUrl()}paths/certificates/${certificateUuid}`,
    RequestBodyWithAuthHeader('GET', null, null)
  )
  return errorHandling(res)
}

export async function getMyPathCertificates(accessToken: string): Promise<PathCertificateRecord[]> {
  const res = await fetch(
    `${getAPIUrl()}paths/certificates/me`,
    RequestBodyWithAuthHeader('GET', null, null, accessToken)
  )
  return errorHandling(res)
}

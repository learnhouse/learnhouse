/**
 * Whether a course actually hands out a certificate.
 *
 * A course has certification ON when a Certifications row exists for it and
 * OFF when it does not — the dashboard toggle creates and deletes that row.
 * `getCourseCertifications()` goes through `getResponseMetadata`, which returns
 * `{ success, data, status }` and swallows parse errors, so a failed request
 * looks like a successful one with a non-list `data` (an error body) or
 * `success: false`. Those cases are NOT "no certification": they are "we don't
 * know yet", and the learner UI must keep its certificate copy rather than
 * telling a certified course's students that nothing is coming.
 */

export type CourseCertificationStatus = 'enabled' | 'disabled' | 'unknown'

export type CourseCertificationsResponse =
  | {
      success?: boolean
      data?: any
      status?: number
    }
  | null
  | undefined

export function getCourseCertificationStatus(
  response: CourseCertificationsResponse
): CourseCertificationStatus {
  if (!response || response.success !== true) return 'unknown'
  if (!Array.isArray(response.data)) return 'unknown'
  return response.data.length > 0 ? 'enabled' : 'disabled'
}

'use client'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getCoursesByUser } from '@services/users/users'
import { getAllUserCertificates, getCertificateByUuid } from '@services/courses/certifications'
import { asArray } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'

// Data the profile renders beyond the user record. Every read goes through
// an endpoint that already enforces what the viewer may see:
//  - authored courses: GET /users/{id}/courses (published + public only,
//    unless the viewer is that user)
//  - featured certificates: the public verification endpoint, kept only when
//    the certificate belongs to the profile's user
//  - own certificates: GET /certifications/user/all (the viewer's own)

export function useAuthoredCourses(userId: number | undefined, accessToken: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['userCourses', userId, 50],
    queryFn: () => getCoursesByUser(String(userId), accessToken as string, 50),
    enabled: enabled && !!userId && !!accessToken,
    staleTime: 60_000,
    select: (res: any) => asArray(res) as any[],
  })
}

/** Certificates the viewer earned in this org (only for their own profile). */
export function useOwnCertificates(orgId: number | undefined, accessToken: string | undefined, enabled = true) {
  return useQuery({
    // Same key (and cache) as the Progress page.
    queryKey: queryKeys.certifications.detail(`user_all_${orgId}`),
    queryFn: () => getAllUserCertificates(orgId as number, accessToken as string),
    select: (res: any) => asArray(res) as any[],
    enabled: enabled && !!accessToken && !!orgId,
    staleTime: 60_000,
  })
}

/** Featured course certificates, verified against the profile's owner. */
export function useFeaturedCertificates(ids: string[], orgId: number | undefined, userUuid: string) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['profile-featured-certificate', id, orgId],
      queryFn: () => getCertificateByUuid(id, orgId as number),
      enabled: !!orgId,
      staleTime: 5 * 60_000,
      retry: false,
    })),
  })
  const certificates = results
    .map((r) => (r.data as any)?.data ?? null)
    .filter((c: any) => c?.certificate_user && c?.user?.user_uuid === userUuid)
  return { certificates, isLoading: results.some((r) => r.isLoading) }
}

/** CertificateCard props from a certificate payload (same mapping as the Progress page). */
export function certificateCardProps(c: any, learnerName: string, awardedDate: string) {
  const config = c.certification?.config || {}
  return {
    certificationName: config.certification_name || c.course?.name,
    certificationDescription: config.certification_description,
    certificationType: config.certification_type,
    certificatePattern: config.certificate_pattern,
    certificateInstructor: config.certificate_instructor,
    certificateId: c.certificate_user.user_certification_uuid,
    awardedDate,
    learnerName,
  }
}

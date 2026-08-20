'use client'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getCourseCertifications } from '@services/courses/certifications'
import { getCourseCertificationStatus } from '@/lib/certifications/enabled'
import type { CourseCertificationStatus } from '@/lib/certifications/enabled'

/**
 * Does this course award a certificate?
 *
 * Learner-facing surfaces use this to avoid promising a certificate the course
 * never had. Only `isEnabled === false && isUnknown === false` means "no
 * certification" — while the answer is loading or the request failed, callers
 * must keep showing whatever they show today.
 */
export function useCourseCertification(course_uuid?: string) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  // Call sites pass the uuid with or without the `course_` prefix; the API and
  // the dashboard's cache entry both use the prefixed form.
  const prefixed_uuid = course_uuid
    ? `course_${course_uuid.replace('course_', '')}`
    : ''

  // Wait for the session before asking: an anonymous request on a private
  // course gets a 403, which would cache an 'unknown' answer for the whole
  // staleTime even though the user is signed in.
  const isSessionReady = session?.status !== 'loading'

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.certifications.byCourse(prefixed_uuid),
    queryFn: () =>
      getCourseCertifications(prefixed_uuid, org.id, null, access_token),
    enabled: !!prefixed_uuid && !!org?.id && isSessionReady,
    staleTime: 60_000,
  })

  const status: CourseCertificationStatus = getCourseCertificationStatus(data)

  return {
    status,
    isEnabled: status === 'enabled',
    isUnknown: status === 'unknown',
    isLoading,
    error,
  }
}

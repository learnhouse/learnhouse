'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

export function useAssignments(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.assignments.list(orgSlug),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}assignments/org_slug/${orgSlug}`,
        accessToken
      ),
    enabled: !!orgSlug && !!accessToken,
    staleTime: 60_000,
  })
}

export function useAssignmentSubmission(assignmentUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.assignments.submission(assignmentUuid),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}assignments/${assignmentUuid}/submissions/me`,
        accessToken
      ),
    enabled: !!assignmentUuid && !!accessToken,
    staleTime: 30_000,
  })
}

export function useAssignmentTaskSubmission(assignmentUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.assignments.taskSubmission(assignmentUuid),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}assignments/${assignmentUuid}/tasks/submissions/me`,
        accessToken
      ),
    enabled: !!assignmentUuid && !!accessToken,
    staleTime: 30_000,
  })
}

export function useAllSubmissions(assignmentUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.assignments.allSubmissions(assignmentUuid),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}assignments/assignment_${assignmentUuid}/submissions`,
        accessToken
      ),
    enabled: !!assignmentUuid && !!accessToken,
    staleTime: 30_000,
  })
}

export function useAssignmentAnalytics(assignmentUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.assignments.analytics(assignmentUuid),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}assignments/assignment_${assignmentUuid}/submissions`,
        accessToken
      ),
    enabled: !!assignmentUuid && !!accessToken,
    staleTime: 60_000,
  })
}

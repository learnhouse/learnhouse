'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getActivityWithAuthHeader } from '@services/courses/activities'

function normalizeActivityUuid(activityUuid: string) {
  if (!activityUuid) return ''
  return activityUuid.startsWith('activity_') ? activityUuid : `activity_${activityUuid}`
}

export function useActivity(activityUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const normalizedUuid = normalizeActivityUuid(activityUuid)

  return useQuery({
    queryKey: queryKeys.activity.detail(normalizedUuid),
    queryFn: () => getActivityWithAuthHeader(normalizedUuid, {}, accessToken),
    enabled: !!normalizedUuid,
    staleTime: 60_000,
  })
}

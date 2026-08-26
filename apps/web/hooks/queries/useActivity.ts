'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getActivityWithAuthHeader } from '@services/courses/activities'

function serviceActivityUuid(activityUuid: string) {
  if (!activityUuid) return ''
  return activityUuid.startsWith('activity_') ? activityUuid.slice('activity_'.length) : activityUuid
}

export function useActivity(activityUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const serviceUuid = serviceActivityUuid(activityUuid)

  return useQuery({
    queryKey: queryKeys.activity.detail(serviceUuid),
    queryFn: () => getActivityWithAuthHeader(serviceUuid, {}, accessToken),
    enabled: !!serviceUuid,
    staleTime: 60_000,
  })
}

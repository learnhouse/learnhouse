'use client'

import { useQuery } from '@tanstack/react-query'
import { useReaderConfig } from '../Reader/ReaderProvider'
import { fetchActivity } from '../services/api'
import type { Activity } from '../types/activity'

export function useActivity(activityId: string) {
  const { baseApiUrl, accessToken } = useReaderConfig()
  return useQuery<Activity>({
    queryKey: ['lh-reader', 'activity', activityId, !!accessToken],
    queryFn: () => fetchActivity(baseApiUrl, activityId, accessToken),
    enabled: !!activityId,
    staleTime: 60_000,
  })
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import {
  getSkyroomStatus,
  listLiveClasses,
  listRemoteRooms,
} from '@services/integrations/skyroom/skyroom'

export function useSkyroomStatus() {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.skyroom.status(),
    queryFn: () => getSkyroomStatus(accessToken),
    staleTime: 5 * 60_000,
  })
}

export function useSkyroomLiveClasses(orgId?: number, courseId?: number) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.skyroom.list(orgId ?? 0, courseId),
    queryFn: () => listLiveClasses(orgId as number, accessToken, courseId),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

// Pre-existing rooms on the Skyroom account. Only fetched on demand (enabled
// flag) since each call hits the Skyroom API's getRooms, which is rate-limited.
export function useSkyroomRemoteRooms(orgId?: number, enabled = false) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.skyroom.remoteRooms(orgId ?? 0),
    queryFn: () => listRemoteRooms(orgId as number, accessToken),
    enabled: !!orgId && enabled,
    staleTime: 30_000,
  })
}

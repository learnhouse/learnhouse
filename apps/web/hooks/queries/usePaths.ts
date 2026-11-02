'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import {
  getMyPathCertificates,
  getMyPaths,
  getOrgPaths,
  getPath,
  getPathLearners,
  getPathsForCourse,
} from '@services/paths/paths'

function useAccessToken() {
  const session = useLHSession() as any
  return session?.data?.tokens?.access_token as string | undefined
}

export function usePaths(orgId?: number) {
  const accessToken = useAccessToken()
  return useQuery({
    queryKey: queryKeys.paths.list(orgId ?? 0),
    queryFn: () => getOrgPaths(orgId as number, accessToken),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}

export function usePath(pathUuid?: string) {
  const accessToken = useAccessToken()
  return useQuery({
    queryKey: queryKeys.paths.detail(pathUuid ?? ''),
    queryFn: () => getPath(pathUuid as string, accessToken),
    enabled: !!pathUuid,
    staleTime: 30_000,
  })
}

export function usePathLearners(pathUuid?: string) {
  const accessToken = useAccessToken()
  return useQuery({
    queryKey: queryKeys.paths.learners(pathUuid ?? ''),
    queryFn: () => getPathLearners(pathUuid as string, accessToken as string),
    enabled: !!pathUuid && !!accessToken,
    staleTime: 30_000,
  })
}

export function useMyPaths(orgId?: number) {
  const accessToken = useAccessToken()
  return useQuery({
    queryKey: queryKeys.paths.mine(orgId ?? 0),
    queryFn: () => getMyPaths(orgId as number, accessToken as string),
    enabled: !!orgId && !!accessToken,
    staleTime: 30_000,
  })
}

export function usePathsForCourse(courseUuid?: string, enabled = true) {
  const accessToken = useAccessToken()
  return useQuery({
    queryKey: queryKeys.paths.forCourse(courseUuid ?? ''),
    queryFn: () => getPathsForCourse(courseUuid as string, accessToken),
    enabled: enabled && !!courseUuid,
    staleTime: 60_000,
  })
}

export function useMyPathCertificates(enabled = true) {
  const accessToken = useAccessToken()
  return useQuery({
    queryKey: queryKeys.paths.myCertificates(),
    queryFn: () => getMyPathCertificates(accessToken as string),
    enabled: enabled && !!accessToken,
    staleTime: 60_000,
  })
}

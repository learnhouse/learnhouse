'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getBoard, getBoards } from '@services/boards/boards'

export function useBoards(orgId: number) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.boards.list(orgId),
    queryFn: () => getBoards(orgId, accessToken!),
    enabled: !!orgId && !!accessToken,
    staleTime: 60_000,
  })
}

export function useBoard(boardUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.boards.detail(boardUuid),
    queryFn: () => getBoard(boardUuid, accessToken!),
    enabled: !!boardUuid && !!accessToken,
    staleTime: 60_000,
  })
}

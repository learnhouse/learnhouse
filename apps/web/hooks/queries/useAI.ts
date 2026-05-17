'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { fetchRAGChatSessions } from '@services/ai/ai'

export function useRagSessions(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.ai.ragSessions(orgSlug),
    queryFn: () => fetchRAGChatSessions(accessToken!, orgSlug),
    enabled: !!orgSlug && !!accessToken,
    staleTime: 60_000,
  })
}

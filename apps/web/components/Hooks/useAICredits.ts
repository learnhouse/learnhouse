'use client'
// The org's AI credit balance and the published per-feature prices, shared by
// every AI surface (estimates before, balance warnings, the usage page).
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  balanceState,
  estimateCredits,
  getAICreditPrices,
  getAICredits,
  type AIBalanceState,
  type AICreditPrices,
  type AICreditsSummary,
} from '@services/ai/credits'

export const aiCreditsKey = (orgId: number | undefined) => ['org', orgId, 'ai-credits'] as const
export const aiCreditPricesKey = (orgId: number | undefined) => ['org', orgId, 'ai-credit-prices'] as const

function useOrgAndToken(orgId?: number) {
  const org = useOrg() as any
  const session = useLHSession() as any
  return { orgId: orgId ?? org?.id, token: session?.data?.tokens?.access_token as string | undefined }
}

export function useAICredits(orgIdArg?: number): {
  credits: AICreditsSummary | undefined
  state: AIBalanceState
  isLoading: boolean
  refresh: () => void
} {
  const { orgId, token } = useOrgAndToken(orgIdArg)
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<AICreditsSummary>({
    queryKey: aiCreditsKey(orgId),
    queryFn: () => getAICredits(orgId, token),
    enabled: !!(token && orgId),
    staleTime: 60_000,
  })
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: aiCreditsKey(orgId) })
  }, [queryClient, orgId])
  return { credits: data, state: balanceState(data), isLoading, refresh }
}

export function useAICreditPrices(orgIdArg?: number): {
  prices: AICreditPrices | undefined
  estimate: (_key: string, _units?: number, _extra?: Record<string, number>) => number | null
  isLoading: boolean
} {
  const { orgId, token } = useOrgAndToken(orgIdArg)
  const { data, isLoading } = useQuery<AICreditPrices>({
    queryKey: aiCreditPricesKey(orgId),
    queryFn: () => getAICreditPrices(orgId, token),
    enabled: !!(token && orgId),
    // Prices change with a deploy, not during a session.
    staleTime: 30 * 60_000,
  })
  const estimate = useCallback(
    (key: string, units = 1, extra?: Record<string, number>) => estimateCredits(data, key, units, extra),
    [data],
  )
  return { prices: data, estimate, isLoading }
}

/** Refresh the balance after an AI request settled (call with no args from any AI surface). */
export function useRefreshAICredits(orgIdArg?: number): () => void {
  const { orgId } = useOrgAndToken(orgIdArg)
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: aiCreditsKey(orgId) })
  }, [queryClient, orgId])
}

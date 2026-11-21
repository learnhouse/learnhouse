'use client'
import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@/lib/query/keys'
import { getPeerReviewMe, type PeerReviewLearnerState, type PeerReviewPrompt } from '@services/courses/peerReview'
import { resolvePrompts } from './peerReviewLogic'

export function useAccessToken(): string | undefined {
  const session = useLHSession() as any
  return session?.data?.tokens?.access_token
}

/**
 * GET /peer-review/me. One cheap call; a 404 (no settings row) or a 402/403
 * (plan gate, no access) all read as "peer review is off" and render nothing.
 */
export function usePeerReviewMe(assignmentUuid: string | undefined, enabled = true) {
  const accessToken = useAccessToken()
  return useQuery<PeerReviewLearnerState | null>({
    queryKey: queryKeys.peerReview.me(assignmentUuid || ''),
    queryFn: async () => {
      try {
        return await getPeerReviewMe(assignmentUuid as string, accessToken as string)
      } catch (e: any) {
        if ([400, 402, 403, 404].includes(e?.status)) return null
        throw e
      }
    },
    enabled: !!(assignmentUuid && accessToken && enabled),
    staleTime: 30_000,
    retry: (count, e: any) => count < 1 && !(e?.status >= 400 && e?.status < 500),
  })
}

export function useInvalidatePeerReview(assignmentUuid: string) {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.peerReview.all(assignmentUuid) }),
    [queryClient, assignmentUuid]
  )
}

/** The prompts to show: instructor-edited labels, else the translated defaults. */
export function usePrompts(prompts: PeerReviewPrompt[] | null | undefined): PeerReviewPrompt[] {
  const { t } = useTranslation()
  return useMemo(
    () =>
      resolvePrompts(prompts, [
        { key: 'strength', label: t('peer_review.common.prompt_strength'), min_chars: 40 },
        { key: 'suggestion', label: t('peer_review.common.prompt_suggestion'), min_chars: 40 },
        { key: 'question', label: t('peer_review.common.prompt_question'), min_chars: 0 },
      ]),
    [prompts, t]
  )
}

/** Toast an API error with the server's message when it has one. */
export function useErrorToast() {
  const { t } = useTranslation()
  return useCallback(
    (e: any, fallbackKey = 'peer_review.learner.error_generic') => {
      const msg = typeof e?.message === 'string' && e.message && !e.message.startsWith('{') ? e.message : t(fallbackKey)
      toast.error(msg)
    },
    [t]
  )
}

export function useFormatDate() {
  const { i18n } = useTranslation()
  return useCallback(
    (at: Date, hasTime: boolean) => {
      const locale = i18n.language || 'en'
      try {
        return hasTime
          ? at.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : at.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
      } catch {
        return at.toDateString()
      }
    },
    [i18n.language]
  )
}

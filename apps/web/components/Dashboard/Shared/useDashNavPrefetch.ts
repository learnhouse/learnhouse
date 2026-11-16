'use client'
import React, { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { prefetchDashData } from '@/lib/query/dashQueries'
import { isClientRenderedLearnerRoute, prefetchLearnerData } from '@/lib/query/learnerQueries'
import { prefetchRouteFull } from '@/lib/navigation/prefetchRoute'

// A pointer that only crosses a link on its way elsewhere shouldn't fetch
// anything; one that rests this long probably means to click.
const HOVER_DELAY_MS = 60

/**
 * Event handlers for a navigation container (dashboard sidebar, mobile tab
 * bar, the org site header, a list of rows). When the pointer rests on,
 * focuses or touches a link inside it, the link's page is prefetched in full
 * and the data that page reads first is put in the query cache, so the click
 * lands on a finished page instead of a spinner. One delegated listener
 * covers every link, hover menus included. `scope` picks dashboard links or
 * org-site links.
 */
export function useDashNavPrefetch(scope: 'dash' | 'learner' = 'dash') {
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const orgslug: string | undefined = org?.slug
  const orgId: number | undefined = org?.id

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)

  const warm = useCallback(
    (href: string) => {
      const ctx = { orgslug, orgId, token }
      if (scope === 'dash') {
        prefetchRouteFull(router, href)
        prefetchDashData(queryClient, href, ctx)
        return
      }
      // Org site: only pages whose payload holds no server-fetched data are
      // prefetched in full; the rest keep Next's default prefetch.
      if (isClientRenderedLearnerRoute(href)) prefetchRouteFull(router, href)
      prefetchLearnerData(queryClient, href, ctx)
    },
    [scope, router, queryClient, orgslug, orgId, token]
  )

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  const onIntent = useCallback(
    (e: React.SyntheticEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank') return cancel()
      const href = link.getAttribute('href') || ''
      // Same-app pages only (not docs, billing or the hub), of this scope.
      const inScope = scope === 'dash' ? href.includes('/dash') : !href.includes('/dash')
      if (!href.startsWith('/') || !inScope) return cancel()
      // pointerover repeats as the pointer moves over the link's children.
      if (pending.current === href) return
      cancel()
      pending.current = href
      const delay = e.type === 'pointerover' || e.type === 'mouseover' ? HOVER_DELAY_MS : 0
      timer.current = setTimeout(() => {
        timer.current = null
        pending.current = null
        warm(href)
      }, delay)
    },
    [cancel, warm]
  )

  return {
    onPointerOver: onIntent,
    onPointerLeave: cancel,
    onFocus: onIntent,
    onTouchStart: onIntent,
  }
}

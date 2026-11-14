'use client'

import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import {
  type BulkAction,
  type NotificationAudience,
  type NotificationCategory,
  type NotificationItem,
  type NotificationPage,
  bulkAction,
  listNotifications,
} from '@services/notifications/notifications'
import { applyLocalRead, refreshCounts, setAudienceCounts, useNotificationEvents, type LiveEvent } from '@/lib/notifications/store'
import { useNotificationSession } from './useNotificationSession'

export type FeedFilters = {
  audience: NotificationAudience
  unreadOnly?: boolean
  category?: NotificationCategory | null
  archived?: boolean
  important?: boolean
  q?: string
  limit?: number
}

export const notificationKeys = {
  all: ['notifications'] as const,
  feed: (orgId: number | undefined, f: FeedFilters) => ['notifications', orgId ?? 0, 'feed', f] as const,
}

/** A paged, filterable notification list that stays live and applies actions optimistically. */
export function useNotificationFeed(filters: FeedFilters, enabled = true) {
  const { token, orgId } = useNotificationSession()
  const qc = useQueryClient()
  const key = notificationKeys.feed(orgId, filters)

  const query = useInfiniteQuery({
    queryKey: key,
    enabled: enabled && !!token,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listNotifications(
        {
          org_id: orgId,
          audience: filters.audience,
          unread_only: filters.unreadOnly,
          category: filters.category,
          archived: filters.archived,
          important: filters.important,
          q: filters.q,
          cursor: pageParam,
          limit: filters.limit ?? 30,
        },
        token!
      ),
    getNextPageParam: (last: NotificationPage) => last.next_cursor,
    staleTime: 15_000,
  })

  const items = useMemo(() => (query.data?.pages || []).flatMap((p) => p.items), [query.data])

  // New rows and changes from other tabs/devices refresh every open list.
  const onLive = useCallback(
    (e: LiveEvent) => {
      if (e.type === 'notification.new' && e.item.audience !== filters.audience) return
      qc.invalidateQueries({ queryKey: notificationKeys.all })
    },
    [qc, filters.audience]
  )
  useNotificationEvents(onLive)

  // Feeds of this audience only (the other bell's lists are left alone).
  const mine = useMemo(
    () => ({
      queryKey: notificationKeys.all,
      predicate: (q: { queryKey: readonly unknown[] }) => (q.queryKey[3] as FeedFilters | undefined)?.audience === filters.audience,
    }),
    [filters.audience]
  )
  const patch = useCallback(
    (fn: (_items: NotificationItem[]) => NotificationItem[]) => {
      qc.setQueriesData<InfiniteData<NotificationPage>>(mine, (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) } : data
      )
    },
    [qc, mine]
  )

  const act = useCallback(
    async (action: BulkAction, uuids: string[] | 'all') => {
      if (!token) return
      const all = uuids === 'all'
      const set = new Set(all ? [] : uuids)
      const hit = (i: NotificationItem) => all || set.has(i.notification_uuid)
      const now = new Date().toISOString()
      // Optimistic badge: reading or archiving unread rows takes them off at
      // once; marking unread puts them back.
      const current = (qc.getQueriesData<InfiniteData<NotificationPage>>(mine)
        .flatMap(([, d]) => d?.pages.flatMap((p) => p.items) || []))
      const touched = new Map<string, NotificationItem>()
      for (const i of current) if (hit(i)) touched.set(i.notification_uuid, i)
      if (all && (action === 'read' || action === 'archive' || action === 'delete')) {
        applyLocalRead(filters.audience, { all: true, category: filters.category })
      } else if (action === 'read' || action === 'archive' || action === 'delete') {
        const rows = [...touched.values()].filter((i) => !i.read)
        if (rows.length) applyLocalRead(filters.audience, { rows })
      } else if (action === 'unread') {
        const rows = [...touched.values()].filter((i) => i.read && !i.archived)
        if (rows.length) applyLocalRead(filters.audience, { rows, delta: 1 })
      }
      // Optimistic: the rows change at once; the server's counts follow.
      patch((list) => {
        if (action === 'delete') return list.filter((i) => !hit(i))
        if (action === 'archive' && !filters.archived) return list.filter((i) => !hit(i))
        if (action === 'unarchive' && filters.archived) return list.filter((i) => !hit(i))
        return list.map((i) =>
          !hit(i)
            ? i
            : action === 'read'
              ? { ...i, read: true, read_at: i.read_at || now }
              : action === 'unread'
                ? { ...i, read: false, read_at: null }
                : i
        )
      })
      try {
        const counts = await bulkAction(token, {
          action,
          notification_uuids: all ? undefined : uuids,
          all,
          org_id: orgId,
          category: all ? filters.category : undefined,
          audience: filters.audience,
        })
        setAudienceCounts(filters.audience, counts)
      } catch {
        qc.invalidateQueries({ queryKey: notificationKeys.all })
      }
      void refreshCounts()
    },
    [token, orgId, filters.audience, filters.archived, filters.category, patch, qc, mine]
  )

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    hasMore: !!query.hasNextPage,
    loadMore: () => query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    refetch: () => query.refetch(),
    act,
  }
}

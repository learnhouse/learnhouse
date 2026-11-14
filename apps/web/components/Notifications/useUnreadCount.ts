'use client'

import type { NotificationAudience } from '@services/notifications/notifications'
import { useNotificationCounts, useNotificationsLive } from '@/lib/notifications/store'
import { useNotificationSession } from './useNotificationSession'

/** Live unread count for one audience (keeps the shared stream open while mounted). */
export function useUnreadCount(audience: NotificationAudience): number {
  const { token, orgId, userId } = useNotificationSession()
  useNotificationsLive({ token, orgId, userId })
  const { counts } = useNotificationCounts()
  return counts?.[audience]?.unread_count ?? 0
}

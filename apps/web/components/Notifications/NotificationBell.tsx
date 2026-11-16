'use client'

import React, { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslation } from 'react-i18next'
import { Bell } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@components/ui/tooltip'
import type { NotificationAudience } from '@services/notifications/notifications'
import { badgeText } from '@/lib/notifications/format'
import { useNotificationCounts, useNotificationsLive } from '@/lib/notifications/store'
import { useNotificationSession } from './useNotificationSession'
import { useNotificationToasts } from './NotificationToasts'
import { useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'

// The dropdown (list, rows, menus) loads on first open.
const NotificationPopover = dynamic(() => import('./NotificationPopover'), {
  ssr: false,
  loading: () => <div className="h-[240px]" />,
})

/**
 * The bell with its unread badge. `audience="personal"` in the learner header,
 * `"admin"` in the dashboard sidebar. Renders nothing when signed out.
 */
export default function NotificationBell({
  audience = 'personal',
  className = '',
  iconSize = 20,
  side = 'bottom',
  align = 'end',
  toasts = true,
  label,
  badgeRing = 'ring-white',
  escape,
  iconWeight = 'fill',
  badgeClass = 'top-0.5 end-0.5',
  tooltipSide = 'bottom',
  withMessages = false,
}: {
  audience?: NotificationAudience
  className?: string
  iconSize?: number
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  toasts?: boolean
  /** Text beside the icon (the dashboard sidebar's expanded row). */
  label?: React.ReactNode
  badgeRing?: string
  /** CSS selector of an ancestor the dropdown should open past (the dashboard sidebar). */
  escape?: string
  iconWeight?: 'fill' | 'duotone' | 'regular' | 'bold'
  /** Badge position, matching the icon button it sits on. */
  badgeClass?: string
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  /** The learner header's inbox: Messages as a second tab, one badge for both. */
  withMessages?: boolean
}) {
  const { t } = useTranslation()
  const { token, orgId, userId, orgslug, signedIn } = useNotificationSession()
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(8)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const onOpenChange = (next: boolean) => {
    if (next && escape && triggerRef.current && (side === 'left' || side === 'right')) {
      // Open beside the sidebar, not over it: add the gap to its edge.
      const wall = triggerRef.current.closest(escape)?.getBoundingClientRect()
      const own = triggerRef.current.getBoundingClientRect()
      if (wall) setOffset(8 + Math.max(0, side === 'right' ? wall.right - own.right : own.left - wall.left))
    }
    setOpen(next)
  }
  useNotificationsLive({ token, orgId, userId })
  useNotificationToasts(audience, orgslug, toasts)
  const { counts } = useNotificationCounts()
  const messagingEnabled = useMessagingEnabled()
  const { unreadTotal: messagesUnread } = useMessaging()
  const merged = withMessages && messagingEnabled
  if (!signedIn || !token) return null
  // In the merged inbox, message notifications are the Messages tab's
  // unread conversations: count them once.
  const scope = counts?.[audience]
  const notifUnread = Math.max(0, (scope?.unread_count ?? 0) - (merged ? scope?.unread_by_category?.messages ?? 0 : 0))
  const unread = notifUnread + (merged ? messagesUnread : 0)
  const aria = merged
    ? unread
      ? t('notifications.inbox_label_unread', { count: unread })
      : t('notifications.inbox')
    : unread
      ? t('notifications.bell_label_unread', { count: unread })
      : t('notifications.bell_label')
  // Open on the tab with something unread (notifications first on a tie).
  const initialTab = merged && notifUnread === 0 && messagesUnread > 0 ? 'messages' : 'notifications'

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <TooltipProvider delayDuration={0}>
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button ref={triggerRef} type="button" aria-label={aria} data-testid={`notification-bell-${audience}`} data-notifications={notifUnread} data-messages={merged ? messagesUnread : undefined} className={`relative ${className}`}>
                <Bell size={iconSize} weight={iconWeight} />
                {label}
                {unread > 0 && (
                  <span
                    data-testid={`notification-badge-${audience}`}
                    className={`absolute ${badgeClass} min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center ring-2 tabular-nums ${badgeRing}`}
                  >
                    {badgeText(unread)}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} className="text-xs">
            {merged ? t('notifications.inbox') : audience === 'admin' ? t('notifications.admin_title') : t('notifications.title')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={offset}
        collisionPadding={8}
        className="lh-follow-theme w-[min(400px,calc(100vw-16px))] overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-lh-floating ring-1 ring-neutral-200"
      >
        {open && (
          <NotificationPopover
            audience={audience}
            onNavigate={() => setOpen(false)}
            messagesUnread={merged ? messagesUnread : undefined}
            initialTab={initialTab}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { BellSimple, GearSix } from '@phosphor-icons/react'
import { SegmentedControl } from '@/design'
import { getUriWithOrg } from '@services/config/config'
import type { NotificationAudience } from '@services/notifications/notifications'
import { useNotificationCounts } from '@/lib/notifications/store'
import { NotificationList } from './NotificationList'
import { useNotificationFeed } from './useNotificationFeed'
import { useNotificationSession } from './useNotificationSession'

const MessagesPanel = dynamic(() => import('./MessagesPanel'), { ssr: false, loading: () => <div className="h-[240px]" /> })

export type InboxTab = 'notifications' | 'messages'

/** The bell's dropdown: title, Mark all read, settings; All / Unread; rows by day; a link to the full page. */
export default function NotificationPopover({
  audience,
  onNavigate,
  messagesUnread,
  initialTab = 'notifications',
}: {
  audience: NotificationAudience
  onNavigate?: () => void
  /** Set (a number) to merge Messages in as a second tab: the inbox. */
  messagesUnread?: number
  initialTab?: InboxTab
}) {
  const { t } = useTranslation()
  const { orgslug } = useNotificationSession()
  const merged = typeof messagesUnread === 'number'
  const [inboxTab, setInboxTab] = useState<InboxTab>(merged ? initialTab : 'notifications')
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const { counts } = useNotificationCounts()
  // Merged with Messages: chat notifications live in the Messages tab only.
  const scope = counts?.[audience]
  const unread = Math.max(0, (scope?.unread_count ?? 0) - (merged ? scope?.unread_by_category?.messages ?? 0 : 0))
  const feed = useNotificationFeed({ audience, unreadOnly: tab === 'unread', limit: 20 })
  const items = merged ? feed.items.filter((i) => i.category !== 'messages') : feed.items
  const fullPage = audience === 'admin' ? '/dash/notifications' : '/notifications'
  const settings = audience === 'admin' ? '/dash/notifications?section=routing' : '/account/notifications'

  return (
    <div className="flex max-h-[min(600px,calc(100dvh-96px))] flex-col" data-testid={`notification-popover-${audience}`}>
      {merged ? (
        <div className="flex items-center gap-1 border-b border-neutral-100 px-2 pt-2" role="tablist" aria-label={t('notifications.inbox')}>
          {([
            ['notifications', t('notifications.title'), unread],
            ['messages', t('notifications.messages_tab'), messagesUnread || 0],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={inboxTab === key}
              data-testid={`inbox-tab-${key}`}
              onClick={() => setInboxTab(key)}
              className={`-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-sm font-semibold transition-colors ${
                inboxTab === key ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'
              }`}
            >
              {label}
              {count > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neutral-900 px-1.5 text-[11px] font-semibold tabular-nums text-white">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          ))}
          <span className="flex-1" />
          {inboxTab === 'notifications' && (
            <>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => feed.act('read', 'all')}
                  className="h-7 rounded-lg px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                >
                  {t('notifications.mark_all_read')}
                </button>
              )}
              <Link
                href={getUriWithOrg(orgslug, settings)}
                onClick={onNavigate}
                aria-label={t('notifications.settings')}
                className="me-1 flex size-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <GearSix size={16} />
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 px-4 pb-2 pt-3.5">
        <h2 className="flex-1 text-[15px] font-semibold text-neutral-900">
          {audience === 'admin' ? t('notifications.admin_title') : t('notifications.title')}
        </h2>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => feed.act('read', 'all')}
            className="h-7 rounded-lg px-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          >
            {t('notifications.mark_all_read')}
          </button>
        )}
        <Link
          href={getUriWithOrg(orgslug, settings)}
          onClick={onNavigate}
          aria-label={t('notifications.settings')}
          className="flex size-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
        >
          <GearSix size={16} />
        </Link>
      </div>
      )}
      {merged && inboxTab === 'messages' ? (
        <MessagesPanel orgslug={orgslug} onNavigate={onNavigate} />
      ) : (
      <>
      <div className={`px-4 pb-1 ${merged ? 'pt-2.5' : ''}`}>
        <SegmentedControl
          ariaLabel={t('notifications.title')}
          value={tab}
          onChange={setTab}
          options={[
            { key: 'all', label: t('notifications.tabs.all') },
            { key: 'unread', label: t('notifications.tabs.unread'), count: unread || undefined },
          ]}
        />
      </div>
      <div className="min-h-[200px] flex-1 overflow-y-auto overscroll-contain">
        {feed.isLoading ? (
          <div aria-hidden className="space-y-1 p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-2">
                <div className="size-9 animate-pulse rounded-full bg-neutral-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-12 text-center" data-testid="notifications-empty">
            <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <BellSimple size={20} />
            </span>
            <p className="text-sm font-semibold text-neutral-900">
              {audience === 'admin' ? t('notifications.empty.admin_title') : t('notifications.empty.title')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              {audience === 'admin' ? t('notifications.empty.admin_body') : t('notifications.empty.body')}
            </p>
          </div>
        ) : (
          <NotificationList items={items} orgslug={orgslug} onAction={(a, i) => feed.act(a, [i.notification_uuid])} onOpen={onNavigate} dense />
        )}
      </div>
      <Link
        href={getUriWithOrg(orgslug, fullPage)}
        onClick={onNavigate}
        className="flex h-11 shrink-0 items-center justify-center border-t border-neutral-100 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      >
        {t('notifications.view_all')}
      </Link>
      </>
      )}
    </div>
  )
}

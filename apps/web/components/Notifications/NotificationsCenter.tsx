'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowCounterClockwise,
  BellSimple,
  CheckSquare,
  EnvelopeOpen,
  EnvelopeSimple,
  GearSix,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  BulkActionBar,
  BulkActionButton,
  Button,
  EmptyState,
  Panel,
  SearchInput,
  SegmentedControl,
  ToolbarSelect,
  buttonClass,
} from '@/design'
import { getUriWithOrg } from '@services/config/config'
import {
  ADMIN_CATEGORIES,
  PERSONAL_CATEGORIES,
  type NotificationAudience,
  type NotificationCategory,
} from '@services/notifications/notifications'
import { useNotificationCounts, useNotificationsLive } from '@/lib/notifications/store'
import { NotificationList } from './NotificationList'
import { useNotificationFeed } from './useNotificationFeed'
import { useNotificationSession } from './useNotificationSession'

type View = 'inbox' | 'unread' | 'archive'

/**
 * The full notifications page: Inbox / Unread / Archive, a category and a
 * priority filter, search, hover actions per row, and a Select mode for bulk
 * actions. `audience="admin"` is the dashboard's needs-attention inbox.
 */
export default function NotificationsCenter({ audience = 'personal' }: { audience?: NotificationAudience }) {
  const { t } = useTranslation()
  const { token, orgId, userId, orgslug } = useNotificationSession()
  useNotificationsLive({ token, orgId, userId })
  const { counts } = useNotificationCounts()
  const scope = counts?.[audience]
  const [view, setView] = useState<View>('inbox')
  const [category, setCategory] = useState<NotificationCategory | null>(null)
  const [important, setImportant] = useState(false)
  const [q, setQ] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const search = q.trim().length >= 2 ? q.trim() : undefined
  const feed = useNotificationFeed({
    audience,
    unreadOnly: view === 'unread',
    archived: view === 'archive',
    category,
    important,
    q: search,
    limit: 30,
  })
  const categories = audience === 'admin' ? ADMIN_CATEGORIES : PERSONAL_CATEGORIES
  const unread = scope?.unread_count ?? 0
  const filtered = !!category || important || !!search

  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggle = (uuid: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(uuid)
      else next.delete(uuid)
      return next
    })
  const bulk = async (action: 'read' | 'unread' | 'archive' | 'unarchive' | 'delete') => {
    const ids = [...selected]
    stopSelecting()
    await feed.act(action, ids)
  }

  const categoryOptions = useMemo(
    () => [
      { value: '', label: t('notifications.all_categories') },
      ...categories.map((c) => {
        const n = scope?.unread_by_category?.[c] || 0
        return { value: c, label: n ? `${t(`notifications.categories.${c}`)} (${n})` : t(`notifications.categories.${c}`) }
      }),
    ],
    [categories, scope, t]
  )

  const settingsHref = audience === 'admin' ? '/dash/notifications?section=routing' : '/account/notifications'

  return (
    <div className="flex flex-col gap-4" data-testid={`notifications-center-${audience}`}>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel={t('notifications.title')}
          value={view}
          onChange={(v) => {
            setView(v)
            stopSelecting()
          }}
          options={[
            { key: 'inbox', label: t('notifications.tabs.inbox') },
            { key: 'unread', label: t('notifications.tabs.unread'), count: unread || undefined },
            { key: 'archive', label: t('notifications.tabs.archive') },
          ]}
        />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {feed.items.length > 0 && (
            <Button
              size="sm"
              icon={<CheckSquare size={14} />}
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              {selecting ? t('notifications.done') : t('notifications.select')}
            </Button>
          )}
          {unread > 0 && view !== 'archive' && !selecting && (
            <Button size="sm" onClick={() => feed.act('read', 'all')}>
              {t('notifications.mark_all_read')}
            </Button>
          )}
          <Link href={getUriWithOrg(orgslug, settingsHref)} className={buttonClass('secondary', 'sm')} aria-label={t('notifications.settings')}>
            <GearSix size={14} />
            <span className="hidden sm:inline">{audience === 'admin' ? t('notifications.routing.short') : t('notifications.settings')}</span>
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
          <ToolbarSelect
            ariaLabel={t('notifications.filter_category')}
            value={category || ''}
            onChange={(v) => setCategory((v || null) as NotificationCategory | null)}
            options={categoryOptions}
          />
          <ToolbarSelect
            ariaLabel={t('notifications.filter_priority')}
            value={important ? 'important' : ''}
            onChange={(v) => setImportant(v === 'important')}
            options={[
              { value: '', label: t('notifications.priority_any') },
              { value: 'important', label: t('notifications.important') },
            ]}
          />
          <SearchInput className="min-w-[200px] flex-1 sm:max-w-sm" value={q} onChange={setQ} placeholder={t('notifications.search_placeholder')} />
        </div>
      <Panel className="overflow-hidden">
        {selecting && feed.items.length > 0 && (
          <label className="flex cursor-pointer items-center gap-3 border-b border-neutral-100 px-5 py-2.5 text-xs font-medium text-neutral-500">
            <input
              type="checkbox"
              checked={feed.items.every((i) => selected.has(i.notification_uuid))}
              onChange={(e) => setSelected(e.target.checked ? new Set(feed.items.map((i) => i.notification_uuid)) : new Set())}
              className="size-4 accent-neutral-900"
            />
            {t('notifications.select_all')}
          </label>
        )}
        {feed.isLoading ? (
          <div aria-hidden className="space-y-1 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-2.5">
                <div className="size-10 animate-pulse rounded-full bg-neutral-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        ) : feed.isError ? (
          <EmptyState
            icon={<WarningCircle size={22} />}
            title={t('notifications.error_title')}
            description={t('notifications.error_body')}
            action={<Button size="sm" onClick={() => feed.refetch()}>{t('notifications.retry')}</Button>}
          />
        ) : feed.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<BellSimple size={22} />}
              title={t('notifications.empty.filtered_title')}
              description={t('notifications.empty.filtered_body')}
              action={
                <Button size="sm" onClick={() => { setCategory(null); setImportant(false); setQ('') }}>
                  {t('notifications.clear_filters')}
                </Button>
              }
            />
          ) : view === 'archive' ? (
            <EmptyState icon={<Archive size={22} />} title={t('notifications.empty.archive_title')} description={t('notifications.empty.archive_body')} />
          ) : (
            <div data-testid="notifications-inbox-zero">
              <EmptyState
                icon={<BellSimple size={22} />}
                title={audience === 'admin' ? t('notifications.empty.admin_title') : t('notifications.empty.title')}
                description={audience === 'admin' ? t('notifications.empty.admin_body') : t('notifications.empty.body')}
              />
            </div>
          )
        ) : (
          <>
            <NotificationList
              items={feed.items}
              orgslug={orgslug}
              onAction={(a, i) => feed.act(a, [i.notification_uuid])}
              selecting={selecting}
              selected={selected}
              onSelect={(i, on) => toggle(i.notification_uuid, on)}
            />
            {feed.hasMore && (
              <div className="border-t border-neutral-100 p-3 text-center">
                <Button size="sm" loading={feed.loadingMore} onClick={() => feed.loadMore()}>
                  {t('notifications.load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      {selecting && selected.size > 0 && (
        <BulkActionBar count={selected.size} label={t('notifications.selected', { count: selected.size })} onClear={() => setSelected(new Set())}>
          <BulkActionButton icon={<EnvelopeOpen size={15} />} label={t('notifications.mark_read')} onClick={() => bulk('read')} />
          <BulkActionButton icon={<EnvelopeSimple size={15} />} label={t('notifications.mark_unread')} onClick={() => bulk('unread')} />
          {view === 'archive' ? (
            <BulkActionButton icon={<ArrowCounterClockwise size={15} />} label={t('notifications.unarchive')} onClick={() => bulk('unarchive')} />
          ) : (
            <BulkActionButton icon={<Archive size={15} />} label={t('notifications.archive')} onClick={() => bulk('archive')} />
          )}
          <BulkActionButton icon={<Trash size={15} />} label={t('notifications.delete')} onClick={() => bulk('delete')} danger />
        </BulkActionBar>
      )}
    </div>
  )
}

'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Archive, ArrowCounterClockwise, EnvelopeOpen, EnvelopeSimple, Trash } from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import type { BulkAction, NotificationItem } from '@services/notifications/notifications'
import { avatarUrl, initials, seedColor, seedInk } from '@components/Messaging/utils'
import { rowTime } from '@/lib/notifications/format'
import { typeLook } from './look'
import { useBody, useHeadline } from './useHeadline'

/** The person who caused it, or a quiet type icon for system events. */
function RowAvatar({ item, size }: { item: NotificationItem; size: number }) {
  const actor = item.actor
  if (actor) {
    const src = avatarUrl(actor as any)
    return src ? (
      <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    ) : (
      <span
        className="flex shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
        style={{ width: size, height: size, background: seedColor(actor.id), color: seedInk(actor.id) }}
      >
        {initials(actor.name)}
      </span>
    )
  }
  const Icon = typeLook(item.type, item.category).Icon
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.47)} />
    </span>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className="flex size-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15"
    >
      {children}
    </button>
  )
}

/**
 * One notification, laid out like a conversation row in Messages: avatar,
 * title (bold while unread) with the time, one line of preview, muted meta.
 * Hover shows read / archive actions in place of the time.
 */
export function NotificationRow({
  item,
  orgslug,
  onAction,
  onOpen,
  dense = false,
  selecting = false,
  selected = false,
  onSelect,
}: {
  item: NotificationItem
  orgslug: string
  onAction: (_action: BulkAction, _item: NotificationItem) => void
  onOpen?: (_item: NotificationItem) => void
  dense?: boolean
  selecting?: boolean
  selected?: boolean
  onSelect?: (_item: NotificationItem, _on: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const headline = useHeadline(item)
  const detail = useBody(item)
  const href = item.path ? getUriWithOrg(orgslug, item.path) : null
  const unread = !item.read && !item.archived
  const category = t(`notifications.categories.${item.category}`, { defaultValue: item.category })

  const open = () => {
    if (!item.read) onAction('read', item)
    onOpen?.(item)
  }

  const body = (
    <>
      {selecting && (
        <input
          type="checkbox"
          aria-label={headline}
          checked={selected}
          onChange={(e) => onSelect?.(item, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="size-4 shrink-0 accent-neutral-900"
        />
      )}
      <RowAvatar item={item} size={dense ? 36 : 40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={`min-w-0 flex-1 text-sm leading-snug ${dense ? 'line-clamp-2' : 'truncate'} ${unread ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-700'}`}>
            {headline}
          </p>
          <span className={`shrink-0 pt-px text-[11px] tabular-nums ${unread ? 'font-semibold text-neutral-900' : 'text-neutral-400'} md:group-hover:invisible`}>
            {rowTime(item.created_at, i18n.language)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={`min-w-0 flex-1 truncate text-xs ${unread ? 'text-neutral-600' : 'text-neutral-500'}`}>
            {detail ? `${detail} · ` : ''}
            <span className="text-neutral-400">{category}</span>
          </p>

          {unread && (
            <span
              aria-label={item.important ? `${t('notifications.unread')}, ${t('notifications.important')}` : t('notifications.unread')}
              className={`size-2 shrink-0 rounded-full ${item.important ? 'bg-amber-500' : 'bg-neutral-900'}`}
            />
          )}
        </div>
      </div>
    </>
  )

  const rowClass = `flex w-full items-center gap-3 rounded-xl ${dense ? 'px-2.5 py-2.5' : 'px-3 py-3'} text-start transition-colors hover:bg-neutral-50 active:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15`

  return (
    <div className="group relative" data-testid="notification-row" data-unread={unread || undefined}>
      {selecting ? (
        <label className={`${rowClass} cursor-pointer ${selected ? 'bg-neutral-100' : ''}`}>{body}</label>
      ) : href ? (
        <Link href={href} onClick={open} className={rowClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={open} className={rowClass}>
          {body}
        </button>
      )}
      {!selecting && (
        <div className={`absolute end-2 ${dense ? 'top-2' : 'top-2.5'} hidden items-center gap-0.5 rounded-lg bg-neutral-50 md:group-hover:flex md:group-focus-within:flex`}>
          {item.archived ? (
            <IconAction label={t('notifications.unarchive')} onClick={() => onAction('unarchive', item)}>
              <ArrowCounterClockwise size={15} />
            </IconAction>
          ) : item.read ? (
            <IconAction label={t('notifications.mark_unread')} onClick={() => onAction('unread', item)}>
              <EnvelopeSimple size={15} />
            </IconAction>
          ) : (
            <IconAction label={t('notifications.mark_read')} onClick={() => onAction('read', item)}>
              <EnvelopeOpen size={15} />
            </IconAction>
          )}
          {item.archived ? (
            <IconAction label={t('notifications.delete')} onClick={() => onAction('delete', item)}>
              <Trash size={15} />
            </IconAction>
          ) : (
            <IconAction label={t('notifications.archive')} onClick={() => onAction('archive', item)}>
              <Archive size={15} />
            </IconAction>
          )}
        </div>
      )}
    </div>
  )
}

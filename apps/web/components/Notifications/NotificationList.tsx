'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { BulkAction, NotificationItem } from '@services/notifications/notifications'
import { groupByDay } from '@/lib/notifications/format'
import { NotificationRow } from './NotificationRow'

/** Rows under day labels (Today, Yesterday, This week, Earlier), styled like the Messages list. */
export function NotificationList({
  items,
  orgslug,
  onAction,
  onOpen,
  dense,
  selecting,
  selected,
  onSelect,
}: {
  items: NotificationItem[]
  orgslug: string
  onAction: (_action: BulkAction, _item: NotificationItem) => void
  onOpen?: (_item: NotificationItem) => void
  dense?: boolean
  selecting?: boolean
  selected?: Set<string>
  onSelect?: (_item: NotificationItem, _on: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div className={dense ? 'px-1.5 pb-1.5' : 'p-2'}>
      {groupByDay(items).map((group) => (
        <section key={`${group.bucket}-${group.items[0].notification_uuid}`} aria-label={t(`notifications.days.${group.bucket}`)}>
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            {t(`notifications.days.${group.bucket}`)}
          </p>
          {group.items.map((item) => (
            <NotificationRow
              key={item.notification_uuid}
              item={item}
              orgslug={orgslug}
              onAction={onAction}
              onOpen={onOpen}
              dense={dense}
              selecting={selecting}
              selected={selected?.has(item.notification_uuid)}
              onSelect={onSelect}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

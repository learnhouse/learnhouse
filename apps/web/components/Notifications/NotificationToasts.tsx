'use client'

import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { getUriWithOrg } from '@services/config/config'
import type { NotificationAudience, NotificationItem } from '@services/notifications/notifications'
import { resolveHeadline } from '@/lib/notifications/format'
import { useNotificationEvents, type LiveEvent } from '@/lib/notifications/store'
import { typeLook } from './look'

// Shown once per row even when several bells are mounted (header + phone).
const toasted = new Set<string>()

/** Toasts important rows of this audience as they arrive (only in the visible tab). */
export function useNotificationToasts(audience: NotificationAudience, orgslug: string, enabled = true) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const onEvent = useCallback(
    (e: LiveEvent) => {
      if (!enabled || e.type !== 'notification.new') return
      const item: NotificationItem = e.item
      if (item.audience !== audience || !item.important || toasted.has(item.notification_uuid)) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      toasted.add(item.notification_uuid)
      const headline = resolveHeadline(
        item,
        (key) => {
          const v = i18n.getResource('en', 'common', key)
          return typeof v === 'string' ? v : undefined
        },
        (key, params) => t(key, params) as string
      )
      const look = typeLook(item.type, item.category)
      const Icon = look.Icon
      toast.custom(
        (tt) => (
          <button
            type="button"
            data-testid="notification-toast"
            onClick={() => {
              toast.dismiss(tt.id)
              if (item.path) router.push(getUriWithOrg(orgslug, item.path))
            }}
            style={{ marginBottom: 'calc(var(--lh-mobile-nav-h, 0px) + 72px)' }}
            className={`lh-follow-theme flex w-[min(360px,calc(100vw-32px))] items-start gap-3 rounded-2xl bg-white p-3.5 text-start shadow-lg ring-1 ring-neutral-200 transition-opacity ${tt.visible ? 'opacity-100' : 'opacity-0'}`}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
              <Icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                {t('notifications.new_toast')}
              </span>
              <span className="mt-0.5 block text-[13.5px] font-semibold leading-snug text-neutral-900">{headline}</span>
              {item.body && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-neutral-500">{item.body}</span>}
            </span>
          </button>
        ),
        { duration: 6000, position: 'bottom-right' }
      )
    },
    [audience, enabled, i18n, orgslug, router, t]
  )
  useNotificationEvents(onEvent)
}

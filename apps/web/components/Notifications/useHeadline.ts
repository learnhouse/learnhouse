'use client'

import { useTranslation } from 'react-i18next'
import type { NotificationItem } from '@services/notifications/notifications'
import { resolveBody, resolveHeadline } from '@/lib/notifications/format'

/** The row's translated headline (falls back to the server's English title). */
export function useHeadline(item: NotificationItem): string {
  const { t, i18n } = useTranslation()
  return resolveHeadline(
    item,
    (key) => {
      const v = i18n.getResource('en', 'common', key)
      return typeof v === 'string' ? v : undefined
    },
    (key, params) => t(key, params) as string
  )
}

/** The row's detail line: localized from its params when there is a template, else the server body. */
export function useBody(item: NotificationItem): string {
  const { t, i18n } = useTranslation()
  return resolveBody(
    item,
    (key) => {
      const v = i18n.getResource('en', 'common', key)
      return typeof v === 'string' ? v : undefined
    },
    (key, params) => t(key, params) as string,
    (iso) => {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return ''
      try {
        return new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d)
      } catch {
        return d.toLocaleString()
      }
    }
  )
}

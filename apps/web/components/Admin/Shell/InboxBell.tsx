'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Checks } from '@phosphor-icons/react'
import { formatRelative } from '@/design'
import { cn } from '@/lib/utils'
import {
  getInbox,
  getInboxUnread,
  isNotAvailable,
  markInboxRead,
} from '@services/ee/platform/api'
import type { InboxItem } from '@services/ee/platform/types'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'
import { asList } from '@components/Admin/Shared/AdminKit'

// The platform team's in-app inbox (§9.3): unread badge in the top bar and a
// short list. Servers without the notifications API show a quiet note.

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  critical: 'bg-rose-400',
}

export default function InboxBell() {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)

  const unread = useQuery({
    queryKey: ['platform', 'inbox', 'unread'],
    queryFn: () => getInboxUnread(token),
    enabled: !!token,
    retry: shouldRetry,
    refetchInterval: (q) => (q.state.error ? false : 60_000),
  })
  const list = useQuery({
    queryKey: ['platform', 'inbox', 'list'],
    queryFn: () => getInbox(token),
    enabled: !!token && open && !(unread.error && isNotAvailable(unread.error)),
    retry: shouldRetry,
  })
  const count = unread.data?.count ?? unread.data?.unread ?? 0
  const unavailable = !!unread.error && isNotAvailable(unread.error)
  const items: InboxItem[] = asList(list.data as any)

  const readAll = async () => {
    try {
      await markInboxRead(token, { all: true })
    } finally {
      queryClient.invalidateQueries({ queryKey: ['platform', 'inbox'] })
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={
            count
              ? t('admin.inbox.label_unread', { count })
              : t('admin.inbox.label')
          }
          className="relative h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--adm-fg-2)] hover:text-[var(--adm-fg)] hover:bg-[var(--adm-hover)] transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <Bell size={16} />
          {count > 0 && (
            <span className="absolute top-0.5 end-0.5 min-w-3.5 h-3.5 px-1 rounded-full bg-rose-500 text-[9px] font-semibold leading-none text-white tabular-nums inline-flex items-center justify-center ring-2 ring-[var(--adm-bar)]">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="adm-bar w-[min(22rem,calc(100vw-1.5rem))] rounded-xl bg-[var(--adm-raised)] shadow-[var(--adm-shadow)] text-[var(--adm-fg)] data-[state=open]:animate-in data-[state=open]:fade-in-0 focus:outline-none"
          style={{ zIndex: 'var(--z-popover)' as any }}
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
            <p className="text-sm font-semibold text-[var(--adm-fg)]">
              {t('admin.inbox.title')}
            </p>
            {count > 0 && (
              <button
                type="button"
                onClick={readAll}
                className="inline-flex items-center gap-1 text-xs text-[var(--adm-fg-3)] hover:text-[var(--adm-fg)]"
              >
                <Checks size={13} />
                {t('admin.inbox.mark_all')}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {unavailable ? (
              <p className="px-4 py-6 text-sm text-[var(--adm-fg-3)]">
                {t('admin.inbox.unavailable')}
              </p>
            ) : list.isLoading ? (
              <p className="px-4 py-6 text-sm text-[var(--adm-fg-3)]">
                {t('common.loading')}
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[var(--adm-fg-3)]">
                {t('admin.inbox.empty')}
              </p>
            ) : (
              items.map((n) => {
                const body = (
                  <>
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        n.read_at
                          ? 'bg-[var(--adm-line)]'
                          : (SEVERITY_DOT[n.severity ?? 'info'] ?? 'bg-sky-400')
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block text-sm',
                          n.read_at
                            ? 'text-[var(--adm-fg-2)]'
                            : 'text-[var(--adm-fg)]'
                        )}
                      >
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="block text-xs text-[var(--adm-fg-3)] line-clamp-2">
                          {n.body}
                        </span>
                      )}
                      <span className="block mt-0.5 text-[11px] text-[var(--adm-fg-3)]">
                        {formatRelative(n.created_at, i18n.language)}
                      </span>
                    </span>
                  </>
                )
                const cls =
                  'flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--adm-hover)]'
                return n.link ? (
                  <Link
                    key={n.id}
                    href={n.link}
                    onClick={() => {
                      setOpen(false)
                      if (!n.read_at) markInboxRead(token, { ids: [n.id] }).finally(() => queryClient.invalidateQueries({ queryKey: ['platform', 'inbox'] }))
                    }}
                    className={cls}
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={n.id} className={cls}>
                    {body}
                  </div>
                )
              })
            )}
          </div>
          {!unavailable && (
            <Link
              href="/admin/notifications?tab=inbox"
              onClick={() => setOpen(false)}
              className="block border-t border-[var(--adm-line)] px-4 py-2.5 text-center text-xs font-semibold text-[var(--adm-fg-2)] hover:text-[var(--adm-fg)] hover:bg-[var(--adm-hover)] rounded-b-xl"
            >
              {t('admin.inbox.view_all')}
            </Link>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

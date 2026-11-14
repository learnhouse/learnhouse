'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Checks, EnvelopeOpen, Lightning, Tray } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, SegmentedControl, formatRelative } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { listInbox, markRead, opsKeys, type InboxEntry } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, useListKeyboard } from '@components/Admin/hooks'
import { ListSkeleton, Pagination, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { SeverityPill, useEventCatalog } from '@components/Admin/Shared/OpsKit'
import FilterBar, { type FilterDef } from '@components/Admin/Shared/FilterBar'

// The full inbox (§9.3): what the bell shows, with paging, an unread view,
// an event filter and bulk "mark read". Opening an entry marks it read and
// follows its console link.

const PAGE_SIZE = 25

const DOT: Record<string, string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-rose-500',
}

export default function InboxTab({
  values,
  setValues,
}: {
  values: Record<string, string | undefined>
  setValues: (_u: Record<string, string | undefined>, _o?: { replace?: boolean }) => void
}) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const router = useRouter()
  const queryClient = useQueryClient()
  const catalog = useEventCatalog()
  const page = Math.max(1, Number(values.page) || 1)
  const unreadOnly = values.unread === '1'
  const [picked, setPicked] = React.useState<{ key: string; ids: Set<number> }>({ key: '', ids: new Set() })

  const query = React.useMemo(
    () => ({ page, limit: PAGE_SIZE, unread: unreadOnly ? true : undefined, event_key: values.event_key || undefined }),
    [page, unreadOnly, values.event_key]
  )
  const q = useQuery({
    queryKey: opsKeys.inbox(query),
    queryFn: () => listInbox(token, query),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const items: InboxEntry[] = Array.isArray(q.data?.items) ? q.data!.items : []
  const total = q.data?.total ?? 0
  const unread = q.data?.unread ?? 0

  // The selection belongs to one page/filter; it empties when they change.
  const viewKey = JSON.stringify(query)
  const selected = picked.key === viewKey ? picked.ids : new Set<number>()
  const setSelected = (next: Set<number> | ((_prev: Set<number>) => Set<number>)) =>
    setPicked({ key: viewKey, ids: typeof next === 'function' ? next(selected) : next })

  const refresh = () => queryClient.invalidateQueries({ queryKey: opsKeys.inbox() })
  const mark = async (body: { ids?: number[]; all?: boolean }, quiet = false) => {
    try {
      const res = await markRead(token, body)
      if (!quiet) toast.success(t('admin.notifications.inbox.marked', { count: res?.marked ?? body.ids?.length ?? 0 }))
      setSelected(new Set())
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      refresh()
    }
  }

  const open = (n: InboxEntry) => {
    if (!n.read_at) mark({ ids: [n.id] }, true)
    if (n.link) router.push(n.link)
  }
  const kb = useListKeyboard(items, open)

  const defs: FilterDef[] = [
    {
      key: 'event_key',
      kind: 'select',
      label: t('admin.notifications.inbox.event'),
      icon: <Lightning size={14} />,
      options: catalog.events.map((e) => ({ value: e.key, label: e.label })),
    },
  ]

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allOnPage = items.length > 0 && items.every((n) => selected.has(n.id))

  return (
    <div className="space-y-4">
      <FilterBar
        values={values}
        onChange={setValues}
        defs={defs}
        end={
          <>
            <SegmentedControl
              ariaLabel={t('admin.notifications.inbox.show')}
              value={unreadOnly ? 'unread' : 'all'}
              onChange={(v) => setValues({ unread: v === 'unread' ? '1' : undefined, page: undefined })}
              options={[
                { key: 'all', label: t('admin.notifications.inbox.all') },
                { key: 'unread', label: t('admin.notifications.inbox.unread'), count: unread || undefined },
              ]}
            />
            {selected.size > 0 ? (
              <Button size="md" icon={<Checks size={14} />} onClick={() => mark({ ids: Array.from(selected) })}>
                {t('admin.notifications.inbox.mark_selected', { count: selected.size })}
              </Button>
            ) : (
              <Button size="md" icon={<Checks size={14} />} disabled={!unread} onClick={() => mark({ all: true })}>
                {t('admin.notifications.inbox.mark_all')}
              </Button>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={unreadOnly ? <Checks size={22} /> : <Tray size={22} />}
            title={unreadOnly ? t('admin.notifications.inbox.caught_up') : t('admin.notifications.inbox.empty_title')}
            description={unreadOnly ? t('admin.notifications.inbox.caught_up_desc') : t('admin.notifications.inbox.empty_desc')}
            action={
              unreadOnly || values.event_key ? (
                <Button size="sm" onClick={() => setValues({ unread: undefined, event_key: undefined, page: undefined })}>
                  {t('admin.notifications.inbox.show_all')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-neutral-100 text-xs font-medium text-neutral-500">
              <input
                type="checkbox"
                aria-label={t('admin.notifications.inbox.select_all')}
                checked={allOnPage}
                onChange={() => setSelected(allOnPage ? new Set() : new Set(items.map((n) => n.id)))}
                className="h-4 w-4 accent-neutral-900"
              />
              <span>{t('admin.notifications.inbox.count', { count: total })}</span>
            </div>
            {items.map((n, i) => {
              const sev = n.severity || 'info'
              return (
                <div
                  key={n.id}
                  {...kb.rowProps(i)}
                  onClick={() => open(n)}
                  className={`flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50 ${selected.has(n.id) ? 'bg-neutral-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={t('admin.notifications.inbox.select', { title: n.title })}
                    checked={selected.has(n.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(n.id)}
                    className="mt-1 h-4 w-4 accent-neutral-900 shrink-0"
                  />
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-neutral-200' : DOT[sev] ?? 'bg-sky-500'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`text-sm min-w-0 break-words ${n.read_at ? 'text-neutral-600' : 'font-semibold text-neutral-900'}`}>{n.title}</span>
                      {sev !== 'info' && <SeverityPill severity={sev} />}
                    </div>
                    {n.body && <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{n.body}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400">
                      <span title={formatDate(n.created_at, i18n.language, true)}>{formatRelative(n.created_at, i18n.language)}</span>
                      {n.event_key && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{catalog.label(n.event_key)}</span>
                        </>
                      )}
                      {n.org_id ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <Link href={adminPath.org(n.org_id)} onClick={(e) => e.stopPropagation()} className="hover:text-neutral-700 hover:underline underline-offset-2">
                            {t('admin.notifications.inbox.org', { id: n.org_id })}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {!n.read_at && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        mark({ ids: [n.id] }, true)
                      }}
                      title={t('admin.notifications.inbox.mark_read')}
                      aria-label={t('admin.notifications.inbox.mark_read')}
                      className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
                    >
                      <EnvelopeOpen size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </Panel>
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={(p) => setValues({ page: p === 1 ? undefined : String(p) })} />
        </>
      )}
    </div>
  )
}

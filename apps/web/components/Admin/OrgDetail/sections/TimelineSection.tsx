'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Buildings, CalendarBlank, CheckSquareOffset, ClockCounterClockwise, Handshake, NotePencil, ShieldStar } from '@phosphor-icons/react'
import { EmptyState, Panel, formatRelative } from '@/design'
import { TIMELINE_KINDS, getTimeline, opsKeys, type TimelineKind } from '@services/ee/platform/ops'
import { useAccessToken, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import { ListSkeleton, Pagination, QueryError, formatDate } from '@components/Admin/Shared/AdminKit'
import FilterBar, { resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'
import { IconTile, type Tone } from '@components/Admin/Shared/OpsKit'

// Everything that happened around this org on one line: notes, tasks, POC
// steps, platform-team changes and the org's own audit events. Kinds and the
// date range live in the URL (tl_kind, tl_since, tl_until, tl_page).

const LIMIT = 30
const KIND_STYLE: Record<string, { icon: React.ReactNode; tone: Tone }> = {
  note: { icon: <NotePencil size={14} />, tone: 'amber' },
  task: { icon: <CheckSquareOffset size={14} />, tone: 'teal' },
  poc: { icon: <Handshake size={14} />, tone: 'violet' },
  platform: { icon: <ShieldStar size={14} />, tone: 'sky' },
  org: { icon: <Buildings size={14} />, tone: 'neutral' },
}

export default function TimelineSection({ orgId }: { orgId: number }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const [url, setUrl] = useUrlQuery()
  const kinds = (url.tl_kind ?? '').split(',').filter((k): k is TimelineKind => (TIMELINE_KINDS as string[]).includes(k))
  const page = Math.max(1, Number(url.tl_page) || 1)
  const query = {
    kind: kinds.length ? kinds.join(',') : undefined,
    since: resolveDate(url.tl_since),
    until: resolveDate(url.tl_until, true),
    page,
    limit: LIMIT,
  }
  const q = useQuery({
    queryKey: opsKeys.timeline(orgId, query),
    queryFn: () => getTimeline(token, orgId, query),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const items = Array.isArray(q.data?.items) ? q.data!.items : []
  const total = q.data?.total ?? 0

  const toggleKind = (k: TimelineKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]
    setUrl({ tl_kind: next.length ? next.join(',') : undefined, tl_page: undefined })
  }
  const defs: FilterDef[] = [{ key: 'tl_date', kind: 'date', sinceKey: 'tl_since', untilKey: 'tl_until', label: t('admin.org.timeline.when'), icon: <CalendarBlank size={14} /> }]

  return (
    <div className="space-y-4">
      <FilterBar values={url} onChange={setUrl} defs={defs} pageKey="tl_page">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('admin.org.timeline.kinds')}>
          {TIMELINE_KINDS.map((k) => {
            const on = kinds.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(k)}
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold transition-colors ${
                  on ? 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20' : 'bg-white nice-shadow text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {KIND_STYLE[k]?.icon}
                {t(`admin.org.timeline.kind_${k}`)}
              </button>
            )
          })}
        </div>
      </FilterBar>

      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState icon={<ClockCounterClockwise size={22} />} title={t('admin.org.timeline.empty_title')} description={t('admin.org.timeline.empty_desc')} />
        </Panel>
      ) : (
        <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : ''}>
          {items.map((item) => {
            const style = KIND_STYLE[item.kind] ?? KIND_STYLE.org
            const row = (
              <>
                <IconTile icon={style.icon} tone={style.tone} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-900 break-words">{item.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400">
                    <span>{t(`admin.org.timeline.kind_${item.kind}`, { defaultValue: item.kind })}</span>
                    {item.body && item.kind !== 'note' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <code className="font-mono text-[11px] text-neutral-500" dir="ltr">
                          {item.body}
                        </code>
                      </>
                    )}
                    {item.actor_label && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-neutral-500">{item.actor_label}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <time dateTime={item.at} title={formatDate(item.at, i18n.language, true)}>
                      {formatRelative(item.at, i18n.language)}
                    </time>
                  </div>
                  {item.kind === 'note' && item.body && <p className="mt-1 text-xs text-neutral-600 line-clamp-2">{item.body}</p>}
                </div>
              </>
            )
            return item.path ? (
              <Link key={`${item.kind}-${item.id}`} href={item.path} className="flex items-start gap-3 px-5 py-3 hover:bg-neutral-50">
                {row}
              </Link>
            ) : (
              <div key={`${item.kind}-${item.id}`} className="flex items-start gap-3 px-5 py-3">
                {row}
              </div>
            )
          })}
        </Panel>
      )}
      <Pagination page={page} total={total} limit={LIMIT} onPage={(p) => setUrl({ tl_page: p > 1 ? String(p) : undefined })} />
    </div>
  )
}
